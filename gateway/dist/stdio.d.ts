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
export {};
