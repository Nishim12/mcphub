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
export {};
