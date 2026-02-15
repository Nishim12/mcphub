/**
 * Multi-upstream MCP proxy.
 * Manages one MCP SDK Client per upstream server (stdio transport).
 * Provides connect / disconnect lifecycle and per-server request forwarding.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { UpstreamConfig } from "./config.js";
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
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
};
export type UpstreamState = {
    config: UpstreamConfig;
    client: Client;
    status: "connected" | "disconnected" | "error";
    lastError?: string;
};
/**
 * Manages MCP SDK Client instances for all configured upstream servers.
 */
export declare class UpstreamManager {
    private upstreams;
    /** Connect to a single upstream. Returns true on success. */
    connect(cfg: UpstreamConfig): Promise<boolean>;
    /** Connect to all upstreams. Continues even if some fail. */
    connectAll(configs: UpstreamConfig[]): Promise<void>;
    /** Get a connected upstream by name. Returns undefined if not connected. */
    get(name: string): UpstreamState | undefined;
    /** Return all upstream states (for health / status endpoints). */
    getAll(): Map<string, UpstreamState>;
    /** Return only healthy (connected) upstreams. */
    getHealthy(): UpstreamState[];
    /** Disconnect a single upstream. */
    disconnect(name: string): Promise<void>;
    /** Disconnect all upstreams. */
    disconnectAll(): Promise<void>;
}
