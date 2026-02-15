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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
/* ------------------------------------------------------------------ */
/*  Token Estimation                                                   */
/* ------------------------------------------------------------------ */
/**
 * Fast token estimator: ~4 chars per token (GPT-family heuristic).
 * Good enough for budget/display purposes without external deps.
 */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
/**
 * Estimate tokens for a tool definition (name + description + schema).
 */
export function estimateToolTokens(tool) {
    let text = tool.name;
    if (tool.description)
        text += " " + tool.description;
    if (tool.inputSchema)
        text += " " + JSON.stringify(tool.inputSchema);
    return estimateTokens(text);
}
/* ------------------------------------------------------------------ */
/*  UsageMonitor class                                                 */
/* ------------------------------------------------------------------ */
const DATA_DIR = resolve(homedir(), ".mcphub");
const DATA_FILE = resolve(DATA_DIR, "usage.json");
const MAX_SEQUENCES = 100;
const SAVE_INTERVAL_MS = 30_000; // auto-save every 30s
export class UsageMonitor {
    data;
    currentSequence = [];
    saveTimer = null;
    dirty = false;
    constructor() {
        this.data = this.load();
        // Auto-save periodically
        this.saveTimer = setInterval(() => {
            if (this.dirty) {
                this.save();
                this.dirty = false;
            }
        }, SAVE_INTERVAL_MS);
    }
    /* ---- Recording ---- */
    /**
     * Record a tools/list response for a server (updates token estimates).
     */
    recordToolsList(serverName, tools) {
        const server = this.ensureServer(serverName);
        server.toolCount = tools.length;
        server.toolListTokenEstimate = tools.reduce((sum, t) => sum + estimateToolTokens(t), 0);
        // Ensure every tool has an entry (even if never called)
        for (const tool of tools) {
            if (!server.tools[tool.name]) {
                server.tools[tool.name] = emptyToolStats();
            }
        }
        this.dirty = true;
    }
    /**
     * Record the start of a tool call. Returns a function to call on completion.
     */
    startToolCall(serverName, toolName) {
        const startTime = Date.now();
        // Track call sequence
        const prefixed = `${serverName}/${toolName}`;
        this.currentSequence.push(prefixed);
        return (success) => {
            const latency = Date.now() - startTime;
            const server = this.ensureServer(serverName);
            const stats = server.tools[toolName] ?? emptyToolStats();
            stats.calls++;
            if (success)
                stats.successes++;
            else
                stats.failures++;
            stats.totalLatencyMs += latency;
            stats.lastCalledAt = new Date().toISOString();
            server.tools[toolName] = stats;
            this.dirty = true;
        };
    }
    /**
     * Flush the current tool call sequence (e.g. at end of a conversation/session).
     */
    flushSequence() {
        if (this.currentSequence.length > 0) {
            this.data.recentSequences.push([...this.currentSequence]);
            // Cap stored sequences
            if (this.data.recentSequences.length > MAX_SEQUENCES) {
                this.data.recentSequences = this.data.recentSequences.slice(-MAX_SEQUENCES);
            }
            this.currentSequence = [];
            this.dirty = true;
        }
    }
    /* ---- Queries ---- */
    /**
     * Get full usage data (for /stats endpoint).
     */
    getStats() {
        return {
            ...this.data,
            analysis: this.analyze(),
        };
    }
    /**
     * Analyze usage data for insights.
     */
    analyze() {
        const deadTools = [];
        const topTools = [];
        const errorProne = [];
        let totalTokens = 0;
        let wastedTokens = 0;
        for (const [serverName, serverStats] of Object.entries(this.data.servers)) {
            totalTokens += serverStats.toolListTokenEstimate;
            for (const [toolName, toolStats] of Object.entries(serverStats.tools)) {
                const tokenCost = estimateToolTokens({
                    name: toolName,
                    description: "(estimated)",
                });
                // Dead tools: registered but never called
                if (toolStats.calls === 0) {
                    deadTools.push({ server: serverName, tool: toolName, tokenCost });
                    wastedTokens += tokenCost;
                }
                // Top tools by call count
                if (toolStats.calls > 0) {
                    topTools.push({
                        server: serverName,
                        tool: toolName,
                        calls: toolStats.calls,
                        avgLatencyMs: toolStats.calls > 0
                            ? Math.round(toolStats.totalLatencyMs / toolStats.calls)
                            : 0,
                    });
                }
                // Error-prone tools (>20% failure rate with at least 3 calls)
                if (toolStats.calls >= 3) {
                    const failureRate = toolStats.failures / toolStats.calls;
                    if (failureRate > 0.2) {
                        errorProne.push({
                            server: serverName,
                            tool: toolName,
                            failureRate: Math.round(failureRate * 100),
                            failures: toolStats.failures,
                        });
                    }
                }
            }
        }
        // Sort top tools descending by calls
        topTools.sort((a, b) => b.calls - a.calls);
        return {
            totalTokens,
            wastedTokens,
            wastedPercent: totalTokens > 0 ? Math.round((wastedTokens / totalTokens) * 100) : 0,
            deadTools,
            topTools: topTools.slice(0, 20),
            errorProne,
        };
    }
    /* ---- Persistence ---- */
    save() {
        try {
            if (!existsSync(DATA_DIR)) {
                mkdirSync(DATA_DIR, { recursive: true });
            }
            this.data.lastSavedAt = new Date().toISOString();
            writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf-8");
        }
        catch (err) {
            console.error(`  [monitor] Failed to save usage data: ${err instanceof Error ? err.message : err}`);
        }
    }
    load() {
        try {
            if (existsSync(DATA_FILE)) {
                const raw = readFileSync(DATA_FILE, "utf-8");
                return JSON.parse(raw);
            }
        }
        catch {
            // Corrupted file — start fresh
        }
        return {
            servers: {},
            recentSequences: [],
            startedAt: new Date().toISOString(),
            lastSavedAt: new Date().toISOString(),
        };
    }
    /* ---- Helpers ---- */
    ensureServer(name) {
        if (!this.data.servers[name]) {
            this.data.servers[name] = {
                tools: {},
                toolListTokenEstimate: 0,
                toolCount: 0,
            };
        }
        return this.data.servers[name];
    }
    /**
     * Clean up: stop auto-save timer and flush data.
     */
    shutdown() {
        if (this.saveTimer)
            clearInterval(this.saveTimer);
        this.flushSequence();
        this.save();
    }
}
/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function emptyToolStats() {
    return {
        calls: 0,
        successes: 0,
        failures: 0,
        totalLatencyMs: 0,
        lastCalledAt: null,
    };
}
