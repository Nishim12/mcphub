/**
 * Protocol Fixer Layer.
 *
 * Makes MCP "just work" by addressing the most common production pain points:
 * 1. Auto-restart crashed stdio server processes (with exponential backoff)
 * 2. Normalize inconsistent error responses into clear JSON-RPC errors
 * 3. Validate tool schemas on first tools/list and log warnings for issues
 */
import type { UpstreamManager } from "./proxy.js";
import type { UpstreamConfig } from "./config.js";
type SchemaIssue = {
    server: string;
    tool: string;
    issue: string;
    severity: "warn" | "error";
};
/**
 * Attempt to restart a failed upstream. Uses exponential backoff.
 * Returns true if restart succeeded.
 */
export declare function tryRestart(manager: UpstreamManager, config: UpstreamConfig): Promise<boolean>;
/**
 * Wrap an upstream call with error normalization.
 * Catches common failure patterns and returns clear, actionable errors.
 */
export declare function withErrorNormalization<T>(serverName: string, operation: string, fn: () => Promise<T>): Promise<T>;
type Tool = {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    [key: string]: unknown;
};
/**
 * Validate tool schemas from a server. Returns a list of issues found.
 * Does not reject tools — just logs warnings so developers can fix their servers.
 */
export declare function validateToolSchemas(serverName: string, tools: Tool[]): SchemaIssue[];
/**
 * Log schema validation issues in a human-friendly format.
 */
export declare function logSchemaIssues(issues: SchemaIssue[]): void;
export {};
