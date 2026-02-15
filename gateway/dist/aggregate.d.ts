/**
 * Multi-server aggregation layer.
 * Merges tools/list from all healthy upstreams and routes tools/call
 * to the correct server using a "serverName/toolName" prefix scheme.
 *
 * Integrates with the protocol fixer for:
 * - Auto-restart of crashed servers
 * - Error normalization for clear, actionable errors
 * - Schema validation on first tools/list
 */
import type { JsonRpcRequest, JsonRpcResponse, UpstreamManager } from "./proxy.js";
import type { GatewayConfig } from "./config.js";
import type { UsageMonitor } from "./monitor.js";
/**
 * Get circuit breaker states for all upstreams (for /health endpoint).
 */
export declare function getCircuitStates(): Record<string, {
    state: string;
    failures: number;
}>;
/**
 * Handle an MCP JSON-RPC request by aggregating across upstreams.
 * The optional monitor parameter enables usage tracking when provided.
 */
export declare function handleRequest(config: GatewayConfig, manager: UpstreamManager, request: JsonRpcRequest, monitor?: UsageMonitor): Promise<JsonRpcResponse>;
