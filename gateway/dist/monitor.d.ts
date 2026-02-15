/**
 * Usage Monitor.
 *
 * Tracks per-server and per-tool metrics:
 * - Call count, success/failure count
 * - Average latency (ms)
 * - Token overhead estimate (from tools/list)
 * - Last called timestamp
 * - Tool call sequences (which tools are called together)
 *
 * Persists to ~/.mcphub/usage.json and exposes via GET /stats.
 */
type ToolStats = {
    /** Total number of calls */
    calls: number;
    /** Number of successful calls */
    successes: number;
    /** Number of failed calls */
    failures: number;
    /** Sum of latencies in ms (divide by calls for average) */
    totalLatencyMs: number;
    /** Timestamp of last call (ISO string) */
    lastCalledAt: string | null;
};
type ServerStats = {
    /** Per-tool stats keyed by tool name (without prefix) */
    tools: Record<string, ToolStats>;
    /** Estimated tokens consumed by this server's tools in tools/list */
    toolListTokenEstimate: number;
    /** Total tools exposed by this server */
    toolCount: number;
};
type UsageData = {
    /** Per-server stats keyed by server name */
    servers: Record<string, ServerStats>;
    /** Recent tool call sequences (last N sessions/calls for pattern detection) */
    recentSequences: string[][];
    /** When stats collection started */
    startedAt: string;
    /** When stats were last saved */
    lastSavedAt: string;
};
export declare class UsageMonitor {
    private data;
    private currentSequence;
    private saveTimer;
    private dirty;
    constructor();
    /**
     * Record a tools/list response for a server (updates token estimates).
     */
    recordToolsList(serverName: string, tools: {
        name: string;
        description?: string;
        inputSchema?: unknown;
    }[]): void;
    /**
     * Record the start of a tool call. Returns a function to call on completion.
     */
    startToolCall(serverName: string, toolName: string): (success: boolean) => void;
    /**
     * Flush the current tool call sequence (e.g. at end of a conversation/session).
     */
    flushSequence(): void;
    /**
     * Get full usage data (for /stats endpoint).
     */
    getStats(): UsageData & {
        analysis: UsageAnalysis;
    };
    /**
     * Analyze usage data for insights.
     */
    analyze(): UsageAnalysis;
    save(): void;
    private load;
    private ensureServer;
    /**
     * Clean up: stop auto-save timer and flush data.
     */
    shutdown(): void;
}
type UsageAnalysis = {
    totalTokens: number;
    wastedTokens: number;
    wastedPercent: number;
    deadTools: {
        server: string;
        tool: string;
        tokenCost: number;
    }[];
    topTools: {
        server: string;
        tool: string;
        calls: number;
        avgLatencyMs: number;
    }[];
    errorProne: {
        server: string;
        tool: string;
        failureRate: number;
        failures: number;
    }[];
};
export {};
