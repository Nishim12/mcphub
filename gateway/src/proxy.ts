/**
 * Multi-upstream MCP proxy.
 * Manages one MCP SDK Client per upstream server (stdio transport).
 * Provides connect / disconnect lifecycle and per-server request forwarding.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { UpstreamConfig } from "./config.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

export type UpstreamState = {
  config: UpstreamConfig;
  client: Client;
  status: "connected" | "disconnected" | "error";
  lastError?: string;
};

/* ------------------------------------------------------------------ */
/*  UpstreamManager                                                    */
/* ------------------------------------------------------------------ */

/**
 * Manages MCP SDK Client instances for all configured upstream servers.
 */
export class UpstreamManager {
  private upstreams = new Map<string, UpstreamState>();

  /** Connect to a single upstream. Returns true on success. */
  async connect(cfg: UpstreamConfig): Promise<boolean> {
    try {
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env as Record<string, string> | undefined,
      });

      const client = new Client(
        { name: "mcp-gateway", version: "0.2.0" },
        { capabilities: {} }
      );

      await client.connect(transport);

      this.upstreams.set(cfg.name, {
        config: cfg,
        client,
        status: "connected",
      });

      console.log(`  [upstream] Connected: ${cfg.name}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [upstream] Failed to connect "${cfg.name}": ${message}`);
      this.upstreams.set(cfg.name, {
        config: cfg,
        client: null as unknown as Client, // placeholder
        status: "error",
        lastError: message,
      });
      return false;
    }
  }

  /** Connect to all upstreams. Continues even if some fail. */
  async connectAll(configs: UpstreamConfig[]): Promise<void> {
    await Promise.all(configs.map((cfg) => this.connect(cfg)));
  }

  /** Get a connected upstream by name. Returns undefined if not connected. */
  get(name: string): UpstreamState | undefined {
    const state = this.upstreams.get(name);
    if (state && state.status === "connected") return state;
    return undefined;
  }

  /** Return all upstream states (for health / status endpoints). */
  getAll(): Map<string, UpstreamState> {
    return this.upstreams;
  }

  /** Return only healthy (connected) upstreams. */
  getHealthy(): UpstreamState[] {
    return [...this.upstreams.values()].filter(
      (s) => s.status === "connected"
    );
  }

  /** Disconnect a single upstream. */
  async disconnect(name: string): Promise<void> {
    const state = this.upstreams.get(name);
    if (!state) return;
    try {
      if (state.status === "connected") {
        await state.client.close();
      }
    } catch {
      // ignore close errors
    }
    state.status = "disconnected";
  }

  /** Disconnect all upstreams. */
  async disconnectAll(): Promise<void> {
    await Promise.all(
      [...this.upstreams.keys()].map((name) => this.disconnect(name))
    );
  }
}
