/**
 * Multi-upstream MCP proxy.
 * Manages one MCP SDK Client per upstream server (stdio transport).
 * Provides connect / disconnect / remove / toggle lifecycle.
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
                enabled: true,
                connectedAt: new Date().toISOString(),
            });
            console.log(`  [upstream] Connected: ${cfg.name}`);
            return true;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`  [upstream] Failed to connect "${cfg.name}": ${message}`);
            this.upstreams.set(cfg.name, {
                config: cfg,
                client: null,
                status: "error",
                enabled: true,
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
        if (state && state.status === "connected" && state.enabled)
            return state;
        return undefined;
    }
    /** Return all upstream states (for health / status endpoints). */
    getAll() {
        return this.upstreams;
    }
    /** Return only healthy (connected + enabled) upstreams. */
    getHealthy() {
        return [...this.upstreams.values()].filter((s) => s.status === "connected" && s.enabled);
    }
    /** Disconnect a single upstream (keeps it in the map as disconnected). */
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
    /** Remove an upstream entirely (disconnect + delete from map). */
    async remove(name) {
        const state = this.upstreams.get(name);
        if (!state)
            return false;
        await this.disconnect(name);
        this.upstreams.delete(name);
        return true;
    }
    /**
     * Toggle an upstream enabled/disabled.
     * Disabled upstreams are disconnected but stay in the map.
     * Re-enabling reconnects them.
     */
    async toggle(name) {
        const state = this.upstreams.get(name);
        if (!state)
            return null;
        if (state.enabled) {
            // Disable: disconnect
            await this.disconnect(name);
            state.enabled = false;
            state.status = "disabled";
            console.log(`  [upstream] Disabled: ${name}`);
            return { enabled: false };
        }
        else {
            // Enable: reconnect
            state.enabled = true;
            const ok = await this.connect(state.config);
            console.log(`  [upstream] Enabled: ${name} (connected=${ok})`);
            return { enabled: true };
        }
    }
}
