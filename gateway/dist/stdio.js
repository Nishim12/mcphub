#!/usr/bin/env node
/**
 * MCP Gateway — stdio transport entry point.
 *
 * This is the entry point for agents that connect via stdio
 * (Claude Desktop, Claude Code, Codex, GitHub Copilot, etc.).
 *
 * The agent spawns this process, then communicates over stdin/stdout
 * using the MCP JSON-RPC protocol. Under the hood, the gateway
 * connects to all configured upstream MCP servers and aggregates
 * their tools — just like the HTTP server does.
 *
 * Usage:
 *   npx mcp-gateway                     # uses config.json in CWD
 *   MCP_GATEWAY_CONFIG=/path/config.json npx mcp-gateway
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { UpstreamManager } from "./proxy.js";
import { UsageMonitor } from "./monitor.js";
import { createGatewayServer } from "./mcp-server.js";
async function main() {
    const config = loadConfig();
    const manager = new UpstreamManager();
    const monitor = new UsageMonitor();
    // Log to stderr so we don't pollute the JSON-RPC stdout stream
    console.error("MCP Gateway (stdio) starting...");
    console.error(`  Configured upstreams: ${config.upstreams.length}`);
    for (const u of config.upstreams) {
        console.error(`    - ${u.name}: ${u.command} ${u.args.join(" ")}`);
    }
    // Connect to all upstreams
    await manager.connectAll(config.upstreams);
    const healthy = manager.getHealthy();
    if (healthy.length === 0) {
        console.error("Warning: No upstream servers connected.");
    }
    else {
        console.error(`  Connected: ${healthy.length}/${config.upstreams.length} upstreams`);
    }
    // Create MCP server and connect via stdio transport
    const server = createGatewayServer(config, manager, monitor);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Gateway (stdio) ready — waiting for requests on stdin");
    // Graceful shutdown
    const shutdown = async () => {
        console.error("\nShutting down MCP Gateway (stdio)...");
        monitor.shutdown();
        await server.close();
        await manager.disconnectAll();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
main().catch((err) => {
    console.error("Failed to start MCP Gateway (stdio):", err);
    process.exit(1);
});
