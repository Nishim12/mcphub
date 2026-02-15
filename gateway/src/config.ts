/**
 * Gateway configuration.
 * Supports both single-upstream (Stage 1 backward compat) and multi-upstream (Stage 2+).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

const UpstreamSchema = z.object({
  /** Unique name for this upstream (used as tool prefix) */
  name: z.string().min(1),
  /** Command to spawn for stdio transport (e.g. "npx", "uvx") */
  command: z.string().min(1),
  /** Arguments for the command */
  args: z.array(z.string()).default([]),
  /** Optional environment variables passed to the spawned process */
  env: z.record(z.string()).optional(),
});

export type UpstreamConfig = z.infer<typeof UpstreamSchema>;

const ResilienceSchema = z.object({
  /** Per-upstream call timeout in ms. Default: 10000 (10s) */
  timeoutMs: z.coerce.number().default(10_000),
  /** Max retry attempts per call. Default: 2 */
  maxRetries: z.coerce.number().default(2),
  /** Consecutive failures before circuit opens. Default: 5 */
  circuitBreakerThreshold: z.coerce.number().default(5),
  /** Time in ms to keep circuit open. Default: 30000 (30s) */
  circuitBreakerResetMs: z.coerce.number().default(30_000),
});

/**
 * Accepts either:
 *  - New format: { upstreams: [...] }
 *  - Legacy format: { upstream: { command, args } }
 */
const ConfigSchema = z
  .object({
    /** Port for the gateway HTTP server */
    port: z.coerce.number().default(3010),

    /** Cache TTL for tools/list in seconds. 0 = disabled. Default: 60 */
    cacheTtlSeconds: z.coerce.number().default(60),

    /** Resilience settings */
    resilience: ResilienceSchema.optional(),

    /** Multi-upstream list (Stage 2+) */
    upstreams: z.array(UpstreamSchema).optional(),

    /** Legacy single-upstream (Stage 1 compat) */
    upstream: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
      })
      .optional(),
  })
  .transform((raw) => {
    // Normalise: always produce an `upstreams` array.
    let upstreams: UpstreamConfig[];

    if (raw.upstreams && raw.upstreams.length > 0) {
      upstreams = raw.upstreams;
    } else if (raw.upstream) {
      // Convert legacy single-upstream → array with name "default"
      upstreams = [
        {
          name: "default",
          command: raw.upstream.command,
          args: raw.upstream.args,
        },
      ];
    } else {
      throw new Error(
        "Config must specify either 'upstreams' (array) or 'upstream' (object)."
      );
    }

    // Validate unique names
    const names = new Set<string>();
    for (const u of upstreams) {
      if (names.has(u.name)) {
        throw new Error(`Duplicate upstream name: "${u.name}"`);
      }
      names.add(u.name);
    }

    const resilience = raw.resilience ?? ResilienceSchema.parse({});

    return {
      port: raw.port,
      cacheTtlSeconds: raw.cacheTtlSeconds,
      resilience,
      upstreams,
    };
  });

type ResilienceConfig = z.infer<typeof ResilienceSchema>;

export type GatewayConfig = {
  port: number;
  cacheTtlSeconds: number;
  resilience: ResilienceConfig;
  upstreams: UpstreamConfig[];
};

/* ------------------------------------------------------------------ */
/*  Loaders                                                            */
/* ------------------------------------------------------------------ */

function loadFromEnv(): Record<string, unknown> | null {
  const upstreamCommand = process.env.MCP_GATEWAY_UPSTREAM_COMMAND;
  if (!upstreamCommand) return null;

  const upstreamArgs = process.env.MCP_GATEWAY_UPSTREAM_ARGS;
  const args = upstreamArgs ? upstreamArgs.split(",").map((s) => s.trim()) : [];

  return {
    port: process.env.MCP_GATEWAY_PORT
      ? parseInt(process.env.MCP_GATEWAY_PORT, 10)
      : 3010,
    upstream: { command: upstreamCommand, args },
  };
}

function loadFromFile(path: string): unknown {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content) as unknown;
}

/**
 * Load gateway configuration. Precedence:
 * 1. MCP_GATEWAY_CONFIG path → JSON file
 * 2. MCP_GATEWAY_UPSTREAM_COMMAND env var (legacy single-upstream)
 * 3. config.json in CWD
 * 4. config.example.json in CWD
 */
export function loadConfig(): GatewayConfig {
  const configPath = process.env.MCP_GATEWAY_CONFIG;
  if (configPath && existsSync(configPath)) {
    return ConfigSchema.parse(loadFromFile(configPath));
  }

  const envConfig = loadFromEnv();
  if (envConfig) {
    return ConfigSchema.parse(envConfig);
  }

  const cwdConfigPaths = [
    resolve(process.cwd(), "config.json"),
    resolve(process.cwd(), "config.example.json"),
  ];

  for (const p of cwdConfigPaths) {
    if (existsSync(p)) {
      return ConfigSchema.parse(loadFromFile(p));
    }
  }

  // Fallback default
  return ConfigSchema.parse({
    port: 3010,
    upstream: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    },
  });
}

/**
 * Save the current runtime config back to a config file.
 * Uses MCP_GATEWAY_CONFIG, then config.json in CWD.
 */
export function saveConfig(config: GatewayConfig): void {
  const configPath =
    process.env.MCP_GATEWAY_CONFIG ??
    resolve(process.cwd(), "config.json");

  const data = {
    port: config.port,
    cacheTtlSeconds: config.cacheTtlSeconds,
    resilience: config.resilience,
    upstreams: config.upstreams.map((u) => ({
      name: u.name,
      command: u.command,
      args: u.args,
      ...(u.env ? { env: u.env } : {}),
    })),
  };

  writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`  [config] Saved to ${configPath}`);
}
