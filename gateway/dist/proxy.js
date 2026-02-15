/**
 * Multi-upstream MCP proxy.
 * Manages one MCP SDK Client per upstream server (stdio transport).
 * Provides connect / disconnect lifecycle and per-server request forwarding.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
/* ------------------------------------------------------------------ */
/*  UpstreamManager                                                    */
/* ------------------------------------------------------------------ */
/**
 * Manages MCP SDK Client instances for all configured upstream servers.
 */
export class UpstreamManager {
    upstreams = new Map();
    /** Connect to a single upstream. Returns true on success. */
    async connect(cfg) {
        try {
            const transport = new StdioClientTransport({
                command: cfg.command,
                args: cfg.args,
                env: cfg.env,
            });
            const client = new Client({ name: "mcp-gateway", version: "0.2.0" }, { capabilities: {} });
            await client.connect(transport);
            this.upstreams.set(cfg.name, {
                config: cfg,
                client,
                status: "connected",
            });
            console.log(`  [upstream] Connected: ${cfg.name}`);
            return true;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`  [upstream] Failed to connect "${cfg.name}": ${message}`);
            this.upstreams.set(cfg.name, {
                config: cfg,
                client: null, // placeholder
                status: "error",
                lastError: message,
            });
            return false;
        }
    }
    /** Connect to all upstreams. Continues even if some fail. */
    async connectAll(configs) {
        await Promise.all(configs.map((cfg) => this.connect(cfg)));
    }
    /** Get a connected upstream by name. Returns undefined if not connected. */
    get(name) {
        const state = this.upstreams.get(name);
        if (state && state.status === "connected")
            return state;
        return undefined;
    }
    /** Return all upstream states (for health / status endpoints). */
    getAll() {
        return this.upstreams;
    }
    /** Return only healthy (connected) upstreams. */
    getHealthy() {
        return [...this.upstreams.values()].filter((s) => s.status === "connected");
    }
    /** Disconnect a single upstream. */
    async disconnect(name) {
        const state = this.upstreams.get(name);
        if (!state)
            return;
        try {
            if (state.status === "connected") {
                await state.client.close();
            }
        }
        catch {
            // ignore close errors
        }
        state.status = "disconnected";
    }
    /** Disconnect all upstreams. */
    async disconnectAll() {
        await Promise.all([...this.upstreams.keys()].map((name) => this.disconnect(name)));
    }
}
