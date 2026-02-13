/**
 * Gateway configuration for Stage 1: single-upstream proxy.
 * Loads from config file or environment variables.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const UpstreamSchema = z.object({
  /** Command to spawn for stdio transport (e.g. "npx", "uvx") */
  command: z.string().min(1),
  /** Arguments for the command (e.g. ["-y", "@modelcontextprotocol/server-time"]) */
  args: z.array(z.string()).default([]),
});

const ConfigSchema = z.object({
  /** Port for the gateway HTTP server */
  port: z.coerce.number().default(3010),
  /** Upstream MCP server configuration (stdio) */
  upstream: UpstreamSchema,
});

export type GatewayConfig = z.infer<typeof ConfigSchema>;

function loadFromEnv(): Partial<GatewayConfig> {
  const upstreamCommand = process.env.MCP_GATEWAY_UPSTREAM_COMMAND;
  const upstreamArgs = process.env.MCP_GATEWAY_UPSTREAM_ARGS;

  if (!upstreamCommand) return {};

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
 * 2. MCP_GATEWAY_UPSTREAM_COMMAND + MCP_GATEWAY_UPSTREAM_ARGS env vars
 * 3. config.json in CWD
 * 4. config.example.json (with default upstream)
 */
export function loadConfig(): GatewayConfig {
  const configPath = process.env.MCP_GATEWAY_CONFIG;
  if (configPath && existsSync(configPath)) {
    const data = loadFromFile(configPath);
    return ConfigSchema.parse(data);
  }

  const envConfig = loadFromEnv();
  if (envConfig.upstream) {
    return ConfigSchema.parse({ ...envConfig, upstream: envConfig.upstream });
  }

  const cwdConfigPaths = [
    resolve(process.cwd(), "config.json"),
    resolve(process.cwd(), "config.example.json"),
  ];

  for (const p of cwdConfigPaths) {
    if (existsSync(p)) {
      const data = loadFromFile(p);
      return ConfigSchema.parse(data);
    }
  }

  // Default: use MCP server-everything for quick testing (has tools, resources, prompts)
  return ConfigSchema.parse({
    port: 3010,
    upstream: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    },
  });
}
