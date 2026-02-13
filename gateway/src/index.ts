/**
 * MCP API Gateway - Stage 1: Single-Upstream Proxy
 *
 * HTTP server that accepts MCP JSON-RPC requests and forwards them
 * to one upstream MCP server (stdio transport).
 */

import express from "express";
import { loadConfig } from "./config.js";
import { forwardRequest, type JsonRpcRequest, type JsonRpcResponse } from "./proxy.js";

async function main() {
  const config = loadConfig();

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.post("/", async (req, res) => {
    try {
      const body = req.body;

      if (!body || typeof body !== "object") {
        res.status(400).json({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Invalid JSON" },
        });
        return;
      }

      // Single request
      if (body.jsonrpc && body.method !== undefined) {
        const request = body as JsonRpcRequest;
        const response = await forwardRequest(config, request);
        res.json(response);
        return;
      }

      // Batch request (array)
      if (Array.isArray(body)) {
        const results = await Promise.all(
          body.map((req: JsonRpcRequest) => forwardRequest(config, req))
        );
        res.json(results);
        return;
      }

      res.status(400).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
    } catch (err) {
      console.error("Gateway error:", err);
      res.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : "Internal error",
        },
      });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", stage: 1 });
  });

  const port = config.port;
  app.listen(port, () => {
    console.log(`MCP Gateway (Stage 1) listening on http://localhost:${port}`);
    console.log(
      `  Upstream: ${config.upstream.command} ${config.upstream.args.join(" ")}`
    );
    console.log(`  POST /  - MCP JSON-RPC endpoint`);
    console.log(`  GET /health - Health check`);
  });
}

main().catch((err) => {
  console.error("Failed to start gateway:", err);
  process.exit(1);
});
