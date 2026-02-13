/**
 * Single-upstream MCP proxy. Forwards JSON-RPC requests to an upstream
 * MCP server via stdio transport.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { GatewayConfig } from "./config.js";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

let upstreamClient: Client | null = null;

/**
 * Create or return the singleton upstream client. Connects on first use.
 */
async function getUpstreamClient(config: GatewayConfig): Promise<Client> {
  if (upstreamClient) {
    return upstreamClient;
  }

  const transport = new StdioClientTransport({
    command: config.upstream.command,
    args: config.upstream.args,
  });

  const client = new Client(
    {
      name: "mcp-gateway",
      version: "0.1.0",
    },
    { capabilities: {} }
  );

  await client.connect(transport);
  upstreamClient = client;
  return client;
}

/**
 * Forward a JSON-RPC request to the upstream MCP server and return the response.
 * Handles: initialize, tools/list, tools/call
 */
export async function forwardRequest(
  config: GatewayConfig,
  request: JsonRpcRequest
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;
  const method = request.method;
  const params = (request.params ?? {}) as Record<string, unknown>;

  try {
    const client = await getUpstreamClient(config);

    if (method === "initialize") {
      // Already done by connect(); return server capabilities
      const serverCaps = client.getServerCapabilities();
      const serverVersion = client.getServerVersion();
      const result = {
        protocolVersion: "2024-11-05",
        capabilities: serverCaps ?? {},
        serverInfo: serverVersion ?? { name: "mcp-gateway-upstream", version: "0.1.0" },
      };
      return { jsonrpc: "2.0", id, result };
    }

    if (method === "tools/list") {
      const response = await client.listTools();
      return { jsonrpc: "2.0", id, result: response };
    }

    if (method === "tools/call") {
      const name = params.name as string;
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (!name) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing tool name in params" },
        };
      }
      const response = await client.callTool({ name, arguments: args });
      return { jsonrpc: "2.0", id, result: response };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not supported by gateway: ${method}`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: `Internal error: ${message}` },
    };
  }
}
