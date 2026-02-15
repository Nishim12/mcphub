/**
 * MCP API Gateway — Multi-Upstream with Management Dashboard
 *
 * HTTP server that accepts MCP JSON-RPC requests, aggregates tools
 * from multiple upstream MCP servers, routes tool calls to the
 * correct server, and exposes a management dashboard + REST API.
 *
 * Supports three MCP transports so any coding agent can connect:
 *   - Streamable HTTP  (POST/GET/DELETE /mcp)  — Cursor, newer agents
 *   - SSE              (GET /sse, POST /messages) — Cline, Windsurf, Claude Desktop
 *   - stdio            (see stdio.ts entry point) — Claude Code, Codex, Copilot
 */

import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { loadConfig, saveConfig, type UpstreamConfig } from "./config.js";
import { UpstreamManager, type JsonRpcRequest } from "./proxy.js";
import { handleRequest, getCircuitStates } from "./aggregate.js";
import { UsageMonitor } from "./monitor.js";
import { createGatewayServer } from "./mcp-server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const startedAt = new Date().toISOString();

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
    console.warn("Warning: No upstream servers connected. Dashboard will still be available.");
  } else {
    console.log(
      `  Connected: ${healthy.length}/${config.upstreams.length} upstreams`
    );
  }

  /* ---- Express app ---- */
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  /* ================================================================ */
  /*  Transport session management                                     */
  /* ================================================================ */

  /** Active transport sessions keyed by session ID */
  const transports: Record<string, Transport> = {};

  /* ================================================================ */
  /*  Streamable HTTP transport  (POST/GET/DELETE /mcp)                */
  /*  Protocol version 2025-11-25 — Cursor, newer agents              */
  /* ================================================================ */

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        const existing = transports[sessionId];
        if (!(existing instanceof StreamableHTTPServerTransport)) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session uses a different transport" },
            id: null,
          });
          return;
        }
        transport = existing;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New session — create transport + server
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            console.log(`  [streamable-http] Session initialized: ${sid}`);
            transports[sid] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.log(`  [streamable-http] Session closed: ${sid}`);
            delete transports[sid];
          }
        };
        const server = createGatewayServer(config, manager, monitor);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[streamable-http] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports[sessionId];
    if (transport instanceof StreamableHTTPServerTransport) {
      await transport.handleRequest(req, res);
    } else {
      res.status(400).send("Session uses a different transport");
    }
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports[sessionId];
    if (transport instanceof StreamableHTTPServerTransport) {
      await transport.handleRequest(req, res);
    } else {
      res.status(400).send("Session uses a different transport");
    }
  });

  /* ================================================================ */
  /*  Legacy SSE transport  (GET /sse, POST /messages)                 */
  /*  Protocol version 2024-11-05 — Cline, Windsurf, Claude Desktop   */
  /* ================================================================ */

  app.get("/sse", async (_req, res) => {
    console.log("  [sse] New SSE connection");
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;
    res.on("close", () => {
      console.log(`  [sse] Connection closed: ${transport.sessionId}`);
      delete transports[transport.sessionId];
    });
    const server = createGatewayServer(config, manager, monitor);
    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing sessionId query parameter");
      return;
    }
    const transport = transports[sessionId];
    if (transport instanceof SSEServerTransport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send("Session uses a different transport");
    }
  });

  /* ================================================================ */
  /*  Legacy JSON-RPC endpoint (backward compat)                       */
  /* ================================================================ */
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
        const request = body as JsonRpcRequest;
        const response = await handleRequest(config, manager, request, monitor);
        res.json(response);
        return;
      }

      // Batch request (array)
      if (Array.isArray(body)) {
        const results = await Promise.all(
          body.map((r: JsonRpcRequest) =>
            handleRequest(config, manager, r, monitor)
          )
        );
        res.json(results);
        return;
      }

      res.status(400).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
    } catch (err) {
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

  /* ================================================================ */
  /*  Health / status endpoint                                        */
  /* ================================================================ */
  app.get("/health", (_req, res) => {
    const allUpstreams = manager.getAll();
    const upstreamStatus: Record<
      string,
      { status: string; enabled: boolean; error?: string }
    > = {};
    for (const [name, state] of allUpstreams) {
      upstreamStatus[name] = {
        status: state.status,
        enabled: state.enabled,
        ...(state.lastError ? { error: state.lastError } : {}),
      };
    }

    res.json({
      status: "ok",
      version: "0.2.0",
      startedAt,
      upstreams: upstreamStatus,
      circuits: getCircuitStates(),
      healthy: manager.getHealthy().length,
      total: allUpstreams.size,
      cacheTtlSeconds: config.cacheTtlSeconds,
    });
  });

  /* ================================================================ */
  /*  Usage stats endpoint                                            */
  /* ================================================================ */
  app.get("/stats", (_req, res) => {
    res.json(monitor.getStats());
  });

  /* ================================================================ */
  /*  Management REST API                                             */
  /* ================================================================ */

  /** List all upstreams with full details */
  app.get("/api/upstreams", (_req, res) => {
    const allUpstreams = manager.getAll();
    const circuits = getCircuitStates();
    const result: Record<string, unknown>[] = [];

    for (const [name, state] of allUpstreams) {
      result.push({
        name,
        command: state.config.command,
        args: state.config.args,
        env: state.config.env,
        status: state.status,
        enabled: state.enabled,
        connectedAt: state.connectedAt ?? null,
        lastError: state.lastError ?? null,
        circuit: circuits[name] ?? null,
      });
    }

    res.json(result);
  });

  /** Add a new upstream server */
  app.post("/api/upstreams", async (req, res) => {
    const { name, command, args, env } = req.body as {
      name?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };

    if (!name || !command) {
      res.status(400).json({ error: "name and command are required" });
      return;
    }

    // Check for duplicate
    if (manager.getAll().has(name)) {
      res.status(409).json({ error: `Upstream "${name}" already exists` });
      return;
    }

    const cfg: UpstreamConfig = {
      name,
      command,
      args: args ?? [],
      env,
    };

    // Connect
    const ok = await manager.connect(cfg);

    // Add to runtime config and persist
    config.upstreams.push(cfg);
    try {
      saveConfig(config);
    } catch (err) {
      console.error("Failed to save config:", err);
    }

    res.status(201).json({
      name,
      connected: ok,
      status: manager.getAll().get(name)?.status ?? "unknown",
    });
  });

  /** Remove an upstream server */
  app.delete("/api/upstreams/:name", async (req, res) => {
    const { name } = req.params;
    const removed = await manager.remove(name);

    if (!removed) {
      res.status(404).json({ error: `Upstream "${name}" not found` });
      return;
    }

    // Remove from runtime config and persist
    config.upstreams = config.upstreams.filter((u) => u.name !== name);
    try {
      saveConfig(config);
    } catch (err) {
      console.error("Failed to save config:", err);
    }

    res.json({ removed: true, name });
  });

  /** Toggle an upstream enabled/disabled */
  app.post("/api/upstreams/:name/toggle", async (req, res) => {
    const { name } = req.params;
    const result = await manager.toggle(name);

    if (!result) {
      res.status(404).json({ error: `Upstream "${name}" not found` });
      return;
    }

    res.json({ name, enabled: result.enabled });
  });

  /** Restart a specific upstream */
  app.post("/api/upstreams/:name/restart", async (req, res) => {
    const { name } = req.params;
    const state = manager.getAll().get(name);

    if (!state) {
      res.status(404).json({ error: `Upstream "${name}" not found` });
      return;
    }

    await manager.disconnect(name);
    const ok = await manager.connect(state.config);
    res.json({ name, connected: ok, status: manager.getAll().get(name)?.status ?? "unknown" });
  });

  /** List all merged tools from healthy servers */
  app.get("/api/tools", async (_req, res) => {
    try {
      const response = await handleRequest(
        config,
        manager,
        { jsonrpc: "2.0", id: "api-tools", method: "tools/list" },
        monitor
      );
      const tools = (response.result as { tools?: unknown[] })?.tools ?? [];
      res.json(tools);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to list tools",
      });
    }
  });

  /** Call a tool (simplified API for the dashboard) */
  app.post("/api/tools/call", async (req, res) => {
    const { name, arguments: args } = req.body as {
      name?: string;
      arguments?: Record<string, unknown>;
    };

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    try {
      const response = await handleRequest(
        config,
        manager,
        {
          jsonrpc: "2.0",
          id: "api-call",
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        monitor
      );

      if (response.error) {
        res.status(400).json({ error: response.error.message, details: response.error });
      } else {
        res.json(response.result);
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to call tool",
      });
    }
  });

  /* ================================================================ */
  /*  MCP Server Registry (powered by MCP Radar)                      */
  /* ================================================================ */

  /** Search for MCP servers in the online registry */
  app.get("/api/registry/search", async (req, res) => {
    const q = (req.query.q as string) || "";
    const page = parseInt(req.query.page as string, 10) || 1;
    const perPage = Math.min(parseInt(req.query.per_page as string, 10) || 20, 128);
    const tags = (req.query.tags as string) || "";
    const sort = (req.query.sort as string) || "trending";

    const params = new URLSearchParams({
      q,
      page: String(page),
      per_page: String(perPage),
      sort,
      order: "desc",
    });
    if (tags) params.set("tags", tags);

    try {
      const response = await fetch(
        `https://mcpradar.com/api/v1/mcp-servers/search?${params.toString()}`
      );
      if (!response.ok) {
        res.status(response.status).json({
          error: `Registry API returned ${response.status}`,
        });
        return;
      }
      const data = await response.json();
      res.json(data);
    } catch (err) {
      console.error("Registry search error:", err);
      res.status(502).json({
        error: "Failed to reach MCP server registry",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /* ================================================================ */
  /*  Dashboard (React SPA)                                           */
  /* ================================================================ */
  const dashboardDist = [
    resolve(__dirname, "..", "dashboard", "dist"),
    resolve(__dirname, "..", "..", "dashboard", "dist"),
  ].find((p) => existsSync(resolve(p, "index.html")));

  if (dashboardDist) {
    console.log(`  [dashboard] Serving React SPA from ${dashboardDist}`);
    app.use("/dashboard/assets", express.static(resolve(dashboardDist, "assets")));
    app.get("/dashboard", (_req, res) => {
      res.sendFile(resolve(dashboardDist, "index.html"));
    });
    app.get(/^\/dashboard\/.+/, (_req, res) => {
      res.sendFile(resolve(dashboardDist, "index.html"));
    });
  } else {
    app.get("/dashboard", (_req, res) => {
      res.status(500).send("Dashboard not built. Run: cd dashboard && npm run build");
    });
  }

  /* ================================================================ */
  /*  Start server                                                    */
  /* ================================================================ */
  const port = config.port;
  app.listen(port, () => {
    console.log(`\nMCP Gateway listening on http://localhost:${port}`);
    console.log(`\n  MCP Transports (for AI agents):`);
    console.log(`    /mcp          - Streamable HTTP  (Cursor, newer agents)`);
    console.log(`    /sse          - SSE              (Cline, Windsurf, Claude Desktop)`);
    console.log(`    stdio         - Run: npx mcp-gateway  (Claude Code, Codex, Copilot)`);
    console.log(`\n  Legacy & Management:`);
    console.log(`    POST /        - JSON-RPC endpoint (backward compat)`);
    console.log(`    GET  /health  - Health check & upstream status`);
    console.log(`    GET  /stats   - Usage stats & insights`);
    console.log(`    /dashboard    - Management dashboard`);
    console.log(`    /api/*        - REST API`);
  });

  /* ---- Graceful shutdown ---- */
  const shutdown = async () => {
    console.log("\nShutting down gateway...");

    // Close all active transport sessions
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].close();
        delete transports[sid];
      } catch {
        // ignore close errors during shutdown
      }
    }

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
