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
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Token Estimation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Fast token estimator: ~4 chars per token (GPT-family heuristic).
 * Good enough for budget/display purposes without external deps.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a tool definition (name + description + schema).
 */
function estimateToolTokens(tool: {
  name: string;
  description?: string;
  inputSchema?: unknown;
}): number {
  let text = tool.name;
  if (tool.description) text += " " + tool.description;
  if (tool.inputSchema) text += " " + JSON.stringify(tool.inputSchema);
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
  private data: UsageData;
  private currentSequence: string[] = [];
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

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
  recordToolsList(
    serverName: string,
    tools: { name: string; description?: string; inputSchema?: unknown }[]
  ): void {
    const server = this.ensureServer(serverName);
    server.toolCount = tools.length;
    server.toolListTokenEstimate = tools.reduce(
      (sum, t) => sum + estimateToolTokens(t),
      0
    );

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
  startToolCall(
    serverName: string,
    toolName: string
  ): (success: boolean) => void {
    const startTime = Date.now();

    // Track call sequence
    const prefixed = `${serverName}/${toolName}`;
    this.currentSequence.push(prefixed);

    return (success: boolean) => {
      const latency = Date.now() - startTime;
      const server = this.ensureServer(serverName);
      const stats = server.tools[toolName] ?? emptyToolStats();

      stats.calls++;
      if (success) stats.successes++;
      else stats.failures++;
      stats.totalLatencyMs += latency;
      stats.lastCalledAt = new Date().toISOString();

      server.tools[toolName] = stats;
      this.dirty = true;
    };
  }

  /**
   * Flush the current tool call sequence (e.g. at end of a conversation/session).
   */
  flushSequence(): void {
    if (this.currentSequence.length > 0) {
      this.data.recentSequences.push([...this.currentSequence]);
      // Cap stored sequences
      if (this.data.recentSequences.length > MAX_SEQUENCES) {
        this.data.recentSequences = this.data.recentSequences.slice(
          -MAX_SEQUENCES
        );
      }
      this.currentSequence = [];
      this.dirty = true;
    }
  }

  /* ---- Queries ---- */

  /**
   * Get full usage data (for /stats endpoint).
   */
  getStats(): UsageData & { analysis: UsageAnalysis } {
    return {
      ...this.data,
      analysis: this.analyze(),
    };
  }

  /**
   * Analyze usage data for insights.
   */
  analyze(): UsageAnalysis {
    const deadTools: { server: string; tool: string; tokenCost: number }[] = [];
    const topTools: {
      server: string;
      tool: string;
      calls: number;
      avgLatencyMs: number;
    }[] = [];
    const errorProne: {
      server: string;
      tool: string;
      failureRate: number;
      failures: number;
    }[] = [];

    let totalTokens = 0;
    let wastedTokens = 0;

    for (const [serverName, serverStats] of Object.entries(
      this.data.servers
    )) {
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
            avgLatencyMs:
              toolStats.calls > 0
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
      wastedPercent:
        totalTokens > 0 ? Math.round((wastedTokens / totalTokens) * 100) : 0,
      deadTools,
      topTools: topTools.slice(0, 20),
      errorProne,
    };
  }

  /* ---- Persistence ---- */

  save(): void {
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
      }
      this.data.lastSavedAt = new Date().toISOString();
      writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error(
        `  [monitor] Failed to save usage data: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  private load(): UsageData {
    try {
      if (existsSync(DATA_FILE)) {
        const raw = readFileSync(DATA_FILE, "utf-8");
        return JSON.parse(raw) as UsageData;
      }
    } catch {
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

  private ensureServer(name: string): ServerStats {
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
  shutdown(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.flushSequence();
    this.save();
  }
}

/* ------------------------------------------------------------------ */
/*  Analysis types                                                     */
/* ------------------------------------------------------------------ */

type UsageAnalysis = {
  totalTokens: number;
  wastedTokens: number;
  wastedPercent: number;
  deadTools: { server: string; tool: string; tokenCost: number }[];
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function emptyToolStats(): ToolStats {
  return {
    calls: 0,
    successes: 0,
    failures: 0,
    totalLatencyMs: 0,
    lastCalledAt: null,
  };
}
