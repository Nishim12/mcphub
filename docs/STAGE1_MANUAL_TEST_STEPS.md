# Stage 1 Manual Testing Steps

Follow these steps to verify the MCP Gateway Stage 1 (single-upstream proxy) implementation.

## Prerequisites

- **Node.js 18+** installed
- **jq** (optional, for pretty-printing JSON): `brew install jq` (macOS)
- Gateway dependencies installed: `cd gateway && npm install`

## Step 1: Start the Test MCP Server (Optional Direct Test)

To compare gateway behavior with direct server access, you can run the upstream server directly:

```bash
# In one terminal - run upstream directly (stdio)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | npx -y @modelcontextprotocol/server-everything
```

You should see a JSON-RPC response with `protocolVersion`, `capabilities`, `serverInfo`, etc.

## Step 2: Start the Gateway

```bash
cd gateway
npm run dev
```

Expected output:

```
MCP Gateway (Stage 1) listening on http://localhost:3010
  Upstream: npx -y @modelcontextprotocol/server-everything
  POST /  - MCP JSON-RPC endpoint
  GET /health - Health check
```

**Configuration:** The gateway uses `config.example.json` by default. To override:

- **Custom config file:** `MCP_GATEWAY_CONFIG=/path/to/config.json npm run dev`
- **Environment vars:** `MCP_GATEWAY_UPSTREAM_COMMAND=npx` and `MCP_GATEWAY_UPSTREAM_ARGS=-y,@modelcontextprotocol/server-everything`

## Step 3: Health Check

```bash
curl http://localhost:3010/health
```

Expected: `{"status":"ok","stage":1}`

## Step 4: Initialize

```bash
curl -s -X POST http://localhost:3010/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "test-client", "version": "1.0" }
    }
  }'
```

**What to verify:**

- Response has `"jsonrpc": "2.0"` and `"id": 1`
- `result.protocolVersion` is `"2024-11-05"`
- `result.capabilities` includes `tools`, `resources`, `prompts`, etc.
- `result.serverInfo.name` is `"mcp-servers/everything"` (from upstream)

## Step 5: List Tools

```bash
curl -s -X POST http://localhost:3010/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

**What to verify:**

- Response includes `result.tools` array
- Tools include `echo`, `get-sum`, `get-env`, etc. (same as calling upstream directly)
- Tool count should match upstream (e.g. 13 tools for server-everything)

## Step 6: Call a Tool

```bash
curl -s -X POST http://localhost:3010/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get-sum",
      "arguments": {"a": 5, "b": 3}
    }
  }'
```

**What to verify:**

- Response has `result.content` with type `"text"` and text `"The sum of 5 and 3 is 8."`
- Behavior matches calling the upstream server directly

## Step 7: Run the Test Script (Alternative)

```bash
cd gateway
chmod +x scripts/test-gateway.sh
./scripts/test-gateway.sh
```

This runs all steps above in sequence. With `jq` installed, output is formatted for readability.

## Checklist Summary

| Test | Expected Result |
|------|-----------------|
| Health | `{"status":"ok","stage":1}` |
| Initialize | Returns upstream capabilities + serverInfo |
| tools/list | Returns same tools as upstream |
| tools/call | Returns correct result (e.g. get-sum 5+3=8) |

## Troubleshooting

- **Gateway fails to start:** Check that port 3010 is free. Use `MCP_GATEWAY_PORT=3011` to change.
- **Upstream spawn error:** Ensure `npx` is available. Run `npm install -g npx` if needed.
- **Tool not found:** Use exact tool names from `tools/list` (e.g. `get-sum`, not `getSum`).
- **Timeout:** First request may be slow (npx downloads the server). Subsequent requests should be faster.
