/**
 * Gateway configuration.
 * Supports both single-upstream (Stage 1 backward compat) and multi-upstream (Stage 2+).
 */
import { z } from "zod";
declare const UpstreamSchema: z.ZodObject<{
    /** Unique name for this upstream (used as tool prefix) */
    name: z.ZodString;
    /** Command to spawn for stdio transport (e.g. "npx", "uvx") */
    command: z.ZodString;
    /** Arguments for the command */
    args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** Optional environment variables passed to the spawned process */
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string> | undefined;
}, {
    name: string;
    command: string;
    args?: string[] | undefined;
    env?: Record<string, string> | undefined;
}>;
export type UpstreamConfig = z.infer<typeof UpstreamSchema>;
declare const ResilienceSchema: z.ZodObject<{
    /** Per-upstream call timeout in ms. Default: 10000 (10s) */
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    /** Max retry attempts per call. Default: 2 */
    maxRetries: z.ZodDefault<z.ZodNumber>;
    /** Consecutive failures before circuit opens. Default: 5 */
    circuitBreakerThreshold: z.ZodDefault<z.ZodNumber>;
    /** Time in ms to keep circuit open. Default: 30000 (30s) */
    circuitBreakerResetMs: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    timeoutMs: number;
    maxRetries: number;
    circuitBreakerThreshold: number;
    circuitBreakerResetMs: number;
}, {
    timeoutMs?: number | undefined;
    maxRetries?: number | undefined;
    circuitBreakerThreshold?: number | undefined;
    circuitBreakerResetMs?: number | undefined;
}>;
export type ResilienceConfig = z.infer<typeof ResilienceSchema>;
export type GatewayConfig = {
    port: number;
    cacheTtlSeconds: number;
    resilience: ResilienceConfig;
    upstreams: UpstreamConfig[];
};
/**
 * Load gateway configuration. Precedence:
 * 1. MCP_GATEWAY_CONFIG path → JSON file
 * 2. MCP_GATEWAY_UPSTREAM_COMMAND env var (legacy single-upstream)
 * 3. config.json in CWD
 * 4. config.example.json in CWD
 */
export declare function loadConfig(): GatewayConfig;
/**
 * Save the current runtime config back to a config file.
 * Uses MCP_GATEWAY_CONFIG, then config.json in CWD.
 */
export declare function saveConfig(config: GatewayConfig): void;
export {};
