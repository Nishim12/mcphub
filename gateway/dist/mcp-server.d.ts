/**
 * MCP Server factory.
 *
 * Creates an MCP SDK Server instance whose tools/list and tools/call
 * handlers delegate to the existing aggregation layer. Each incoming
 * client session (SSE, Streamable HTTP, or stdio) gets its own Server
 * via this factory.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { GatewayConfig } from "./config.js";
import type { UpstreamManager } from "./proxy.js";
import type { UsageMonitor } from "./monitor.js";
/**
 * Create an MCP Server wired to the gateway's aggregation layer.
 * Each transport session should call this once to get its own Server
 * instance, then connect the appropriate transport.
 */
export declare function createGatewayServer(config: GatewayConfig, manager: UpstreamManager, monitor: UsageMonitor): Server;
