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

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  UpstreamManager,
} from "./proxy.js";
import type { GatewayConfig } from "./config.js";
import {
  tryRestart,
  withErrorNormalization,
  validateToolSchemas,
  logSchemaIssues,
} from "./fixer.js";
import type { UsageMonitor } from "./monitor.js";
import { Cache } from "./cache.js";
import {
  CircuitBreaker,
  withTimeout,
  withRetry,
} from "./resilience.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Separator between server name and tool name */
const PREFIX_SEP = "/";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type Tool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Track which servers have had their schemas validated */
const validatedServers = new Set<string>();

/** Per-upstream circuit breakers (initialized on first use) */
const circuitBreakers = new Map<string, CircuitBreaker>();

/** Tools list cache (initialized on first handleRequest call) */
let toolsCache: Cache<Tool[]> | null = null;

function getCircuitBreaker(
  name: string,
  config: GatewayConfig
): CircuitBreaker {
  let cb = circuitBreakers.get(name);
  if (!cb) {
    cb = new CircuitBreaker(name, {
      failureThreshold: config.resilience.circuitBreakerThreshold,
      resetTimeoutMs: config.resilience.circuitBreakerResetMs,
    });
    circuitBreakers.set(name, cb);
  }
  return cb;
}

function getToolsCache(config: GatewayConfig): Cache<Tool[]> {
  if (!toolsCache) {
    toolsCache = new Cache<Tool[]>(config.cacheTtlSeconds);
  }
  return toolsCache;
}

/**
 * Get circuit breaker states for all upstreams (for /health endpoint).
 */
export function getCircuitStates(): Record<
  string,
  { state: string; failures: number }
> {
  const states: Record<string, { state: string; failures: number }> = {};
  for (const [name, cb] of circuitBreakers) {
    states[name] = cb.getState();
  }
  return states;
}

/** Prefix a tool name with the server name: "github/search_repos" */
function prefixTool(
  serverName: string,
  tool: Tool,
  singleServer: boolean
): Tool {
  if (singleServer) return tool;
  return { ...tool, name: `${serverName}${PREFIX_SEP}${tool.name}` };
}

/** Parse a prefixed tool name back into { serverName, toolName }. */
function parsePrefixedName(
  prefixed: string,
  singleServer: boolean,
  defaultServer?: string
): { serverName: string; toolName: string } | null {
  if (singleServer && defaultServer) {
    return { serverName: defaultServer, toolName: prefixed };
  }

  const idx = prefixed.indexOf(PREFIX_SEP);
  if (idx === -1) {
    if (defaultServer) return { serverName: defaultServer, toolName: prefixed };
    return null;
  }
  return {
    serverName: prefixed.slice(0, idx),
    toolName: prefixed.slice(idx + 1),
  };
}

/* ------------------------------------------------------------------ */
/*  Request handler                                                    */
/* ------------------------------------------------------------------ */

/**
 * Handle an MCP JSON-RPC request by aggregating across upstreams.
 * The optional monitor parameter enables usage tracking when provided.
 */
export async function handleRequest(
  config: GatewayConfig,
  manager: UpstreamManager,
  request: JsonRpcRequest,
  monitor?: UsageMonitor
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;
  const method = request.method;
  const params = (request.params ?? {}) as Record<string, unknown>;
  const singleServer = config.upstreams.length === 1;

  try {
    if (method === "initialize") {
      return handleInitialize(id, manager);
    }

    if (method === "tools/list") {
      return await handleToolsList(id, config, manager, singleServer, monitor);
    }

    if (method === "tools/call") {
      return await handleToolsCall(
        id,
        params,
        config,
        manager,
        singleServer,
        monitor
      );
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not supported by gateway: ${method}`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: `Gateway error: ${message}` },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Method handlers                                                    */
/* ------------------------------------------------------------------ */

function handleInitialize(
  id: string | number | null,
  manager: UpstreamManager
): JsonRpcResponse {
  const healthy = manager.getHealthy();

  const mergedCapabilities: Record<string, unknown> = {};
  const serverNames: string[] = [];

  for (const upstream of healthy) {
    const caps = upstream.client.getServerCapabilities();
    if (caps) {
      Object.assign(mergedCapabilities, caps);
    }
    serverNames.push(upstream.config.name);
  }

  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: mergedCapabilities,
      serverInfo: {
        name: "mcp-gateway",
        version: "0.2.0",
      },
      _gateway: {
        upstreams: serverNames,
        healthy: healthy.length,
        total: manager.getAll().size,
      },
    },
  };
}

async function handleToolsList(
  id: string | number | null,
  config: GatewayConfig,
  manager: UpstreamManager,
  singleServer: boolean,
  monitor?: UsageMonitor
): Promise<JsonRpcResponse> {
  const healthy = manager.getHealthy();
  const cache = getToolsCache(config);

  const results = await Promise.allSettled(
    healthy.map(async (upstream) => {
      const serverName = upstream.config.name;
      const cb = getCircuitBreaker(serverName, config);

      // Check cache first
      const cached = cache.get(`tools:${serverName}`);
      if (cached.hit) {
        return { serverName, tools: cached.data, fromCache: true };
      }

      // Fetch through circuit breaker + timeout + retry + error normalization
      const tools = await cb.execute(() =>
        withRetry(
          () =>
            withTimeout(
              () =>
                withErrorNormalization(serverName, "tools/list", async () => {
                  const response = await upstream.client.listTools();
                  return (response.tools ?? []) as Tool[];
                }),
              config.resilience.timeoutMs,
              `${serverName}/tools/list`
            ),
          `${serverName}/tools/list`,
          { maxRetries: config.resilience.maxRetries }
        )
      );

      // Cache the result
      cache.set(`tools:${serverName}`, tools);

      // Validate schemas on first fetch (fixer layer)
      if (!validatedServers.has(serverName)) {
        validatedServers.add(serverName);
        const issues = validateToolSchemas(serverName, tools);
        logSchemaIssues(issues);
      }

      // Record tool list for token estimation (monitor layer)
      if (monitor) {
        monitor.recordToolsList(serverName, tools);
      }

      return { serverName, tools, fromCache: false };
    })
  );

  const mergedTools: Tool[] = [];
  const failedServers: string[] = [];
  let cacheHits = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      const { serverName, tools, fromCache } = result.value;
      if (fromCache) cacheHits++;
      for (const tool of tools) {
        mergedTools.push(prefixTool(serverName, tool, singleServer));
      }
    } else {
      const failedUpstream = healthy[i];
      failedServers.push(failedUpstream.config.name);
      const upstreamCfg = config.upstreams.find(
        (u) => u.name === failedUpstream.config.name
      );
      if (upstreamCfg) {
        tryRestart(manager, upstreamCfg).catch(() => {});
      }
    }
  }

  if (failedServers.length > 0) {
    console.warn(
      `  [aggregate] tools/list: ${failedServers.length} server(s) failed: ${failedServers.join(", ")}. Returning partial results.`
    );
  }

  return {
    jsonrpc: "2.0",
    id,
    result: {
      tools: mergedTools,
      ...(failedServers.length > 0
        ? { _gateway: { degraded: true, failedServers } }
        : {}),
    },
    // Non-standard headers (informational)
    ...(cacheHits > 0
      ? { _cache: { hits: cacheHits, total: results.length } }
      : {}),
  } as JsonRpcResponse;
}

async function handleToolsCall(
  id: string | number | null,
  params: Record<string, unknown>,
  config: GatewayConfig,
  manager: UpstreamManager,
  singleServer: boolean,
  monitor?: UsageMonitor
): Promise<JsonRpcResponse> {
  const rawName = params.name as string | undefined;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  if (!rawName) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: "Missing tool name in params" },
    };
  }

  const allUpstreams = manager.getAll();
  const firstServer = allUpstreams.keys().next().value as string | undefined;

  const parsed = parsePrefixedName(rawName, singleServer, firstServer);
  if (!parsed) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32602,
        message: `Cannot determine server from tool name "${rawName}". Use "serverName/toolName" format.`,
      },
    };
  }

  let upstream = manager.get(parsed.serverName);

  // If the server is down, attempt a restart before failing (fixer layer)
  if (!upstream) {
    const upstreamCfg = config.upstreams.find(
      (u) => u.name === parsed.serverName
    );
    if (upstreamCfg) {
      console.log(
        `  [fixer] ${parsed.serverName} is down for tools/call — attempting restart...`
      );
      const restarted = await tryRestart(manager, upstreamCfg);
      if (restarted) {
        upstream = manager.get(parsed.serverName);
      }
    }
  }

  if (!upstream) {
    const available = manager
      .getHealthy()
      .map((s) => s.config.name)
      .join(", ");
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32602,
        message: `Server "${parsed.serverName}" is not available. Connected servers: [${available}]`,
      },
    };
  }

  // Start monitoring the call
  const endCall = monitor?.startToolCall(parsed.serverName, parsed.toolName);
  const cb = getCircuitBreaker(parsed.serverName, config);

  try {
    const response = await cb.execute(() =>
      withTimeout(
        () =>
          withErrorNormalization(
            parsed.serverName,
            `tools/call(${parsed.toolName})`,
            () =>
              upstream!.client.callTool({
                name: parsed.toolName,
                arguments: args,
              })
          ),
        config.resilience.timeoutMs,
        `${parsed.serverName}/tools/call(${parsed.toolName})`
      )
    );
    endCall?.(true);
    return { jsonrpc: "2.0", id, result: response };
  } catch (err) {
    endCall?.(false);

    // On crash during call, trigger background restart
    const upstreamCfg = config.upstreams.find(
      (u) => u.name === parsed.serverName
    );
    if (upstreamCfg) {
      tryRestart(manager, upstreamCfg).catch(() => {});
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message },
    };
  }
}
