# MCP API Gateway — Stage 1

Single-upstream proxy: client → gateway → one MCP server.

## Quick Start

```bash
npm install
npm run dev
```

Gateway runs on http://localhost:3010. Default upstream: `@modelcontextprotocol/server-everything` (stdio).

## Configuration

| Source | Options |
|--------|---------|
| File | `config.json` or `config.example.json` in CWD |
| Env | `MCP_GATEWAY_CONFIG=/path/to/config.json` |
| Env | `MCP_GATEWAY_UPSTREAM_COMMAND`, `MCP_GATEWAY_UPSTREAM_ARGS`, `MCP_GATEWAY_PORT` |

Example `config.json`:

```json
{
  "port": 3010,
  "upstream": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-everything"]
  }
}
```

## Endpoints

- **POST /** — MCP JSON-RPC (initialize, tools/list, tools/call)
- **GET /health** — Health check

## Testing

See [STAGE1_MANUAL_TEST_STEPS.md](../docs/STAGE1_MANUAL_TEST_STEPS.md) for detailed manual testing steps.

Quick test:

```bash
./scripts/test-gateway.sh
```
