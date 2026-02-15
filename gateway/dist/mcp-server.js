/**
 * MCP Server factory.
 *
 * Creates an MCP SDK Server instance whose tools/list and tools/call
 * handlers delegate to the existing aggregation layer. Each incoming
 * client session (SSE, Streamable HTTP, or stdio) gets its own Server
 * via this factory.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { handleRequest } from "./aggregate.js";
/**
 * Create an MCP Server wired to the gateway's aggregation layer.
 * Each transport session should call this once to get its own Server
 * instance, then connect the appropriate transport.
 */
export function createGatewayServer(config, manager, monitor) {
    const server = new Server({ name: "mcp-gateway", version: "0.2.0" }, { capabilities: { tools: {} } });
    /* ---- tools/list ---- */
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const response = await handleRequest(config, manager, { jsonrpc: "2.0", id: "mcp-sdk-internal", method: "tools/list" }, monitor);
        if (response.error) {
            throw new Error(response.error.message);
        }
        const result = response.result;
        return { tools: result?.tools ?? [] };
    });
    /* ---- tools/call ---- */
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const response = await handleRequest(config, manager, {
            jsonrpc: "2.0",
            id: "mcp-sdk-internal",
            method: "tools/call",
            params: {
                name: request.params.name,
                arguments: request.params.arguments ?? {},
            },
        }, monitor);
        if (response.error) {
            throw new Error(response.error.message);
        }
        // The upstream callTool result is already in MCP SDK format
        // (contains `content` array, optional `isError`, etc.)
        return response.result;
    });
    return server;
}
