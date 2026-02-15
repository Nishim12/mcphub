/**
 * MCP API Gateway — Multi-Upstream
 *
 * HTTP server that accepts MCP JSON-RPC requests, aggregates tools
 * from multiple upstream MCP servers, and routes tool calls to the
 * correct server.
 */
import express from "express";
import { loadConfig } from "./config.js";
import { UpstreamManager } from "./proxy.js";
import { handleRequest, getCircuitStates } from "./aggregate.js";
import { UsageMonitor } from "./monitor.js";
async function main() {
    const config = loadConfig();
    const manager = new UpstreamManager();
    const monitor = new UsageMonitor();
    console.log("MCP Gateway starting...");
    console.log(`  Configured upstreams: ${config.upstreams.length}`);
    for (const u of config.upstreams) {
        console.log(`    - ${u.name}: ${u.command} ${u.args.join(" ")}`);
    }
    // Connect to all upstreams
    await manager.connectAll(config.upstreams);
    const healthy = manager.getHealthy();
    if (healthy.length === 0) {
        console.error("No upstream servers connected. Exiting.");
        process.exit(1);
    }
    console.log(`  Connected: ${healthy.length}/${config.upstreams.length} upstreams`);
    /* ---- Express app ---- */
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    /* ---- MCP JSON-RPC endpoint ---- */
    app.post("/", async (req, res) => {
        try {
            const body = req.body;
            if (!body || typeof body !== "object") {
                res.status(400).json({
                    jsonrpc: "2.0",
                    id: null,
                    error: { code: -32700, message: "Invalid JSON" },
                });
                return;
            }
            // Single request
            if (body.jsonrpc && body.method !== undefined) {
                const request = body;
                const response = await handleRequest(config, manager, request, monitor);
                res.json(response);
                return;
            }
            // Batch request (array)
            if (Array.isArray(body)) {
                const results = await Promise.all(body.map((r) => handleRequest(config, manager, r, monitor)));
                res.json(results);
                return;
            }
            res.status(400).json({
                jsonrpc: "2.0",
                id: null,
                error: { code: -32600, message: "Invalid Request" },
            });
        }
        catch (err) {
            console.error("Gateway error:", err);
            res.status(500).json({
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32603,
                    message: err instanceof Error ? err.message : "Internal error",
                },
            });
        }
    });
    /* ---- Health / status endpoint ---- */
    app.get("/health", (_req, res) => {
        const allUpstreams = manager.getAll();
        const upstreamStatus = {};
        for (const [name, state] of allUpstreams) {
            upstreamStatus[name] = {
                status: state.status,
                ...(state.lastError ? { error: state.lastError } : {}),
            };
        }
        res.json({
            status: "ok",
            version: "0.2.0",
            upstreams: upstreamStatus,
            circuits: getCircuitStates(),
            healthy: manager.getHealthy().length,
            total: allUpstreams.size,
            cacheTtlSeconds: config.cacheTtlSeconds,
        });
    });
    /* ---- Usage stats endpoint ---- */
    app.get("/stats", (_req, res) => {
        res.json(monitor.getStats());
    });
    /* ---- Start server ---- */
    const port = config.port;
    app.listen(port, () => {
        console.log(`\nMCP Gateway listening on http://localhost:${port}`);
        console.log(`  POST /       - MCP JSON-RPC endpoint`);
        console.log(`  GET  /health - Health check & upstream status`);
        console.log(`  GET  /stats  - Usage stats & insights`);
    });
    /* ---- Graceful shutdown ---- */
    const shutdown = async () => {
        console.log("\nShutting down gateway...");
        monitor.shutdown();
        await manager.disconnectAll();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
main().catch((err) => {
    console.error("Failed to start gateway:", err);
    process.exit(1);
});
