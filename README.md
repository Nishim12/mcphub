# MCP Hub

An intelligent gateway and management layer for [Model Context Protocol](https://modelcontextprotocol.io/) servers. MCP Hub sits between your AI coding agent (Cursor, Claude Code, Windsurf, etc.) and your upstream MCP servers, providing multi-server aggregation, resilience, token-aware optimization, and a web dashboard — all through a single endpoint.

## Why MCP Hub?

When you connect multiple MCP servers to an AI agent, you quickly run into real problems:

- **Token bloat** — 10 servers can consume 50k–80k+ tokens of context before you type anything, leaving little room for actual conversation.
- **Fragile connections** — One crashed server takes down your whole tool setup with cryptic errors.
- **No visibility** — You can't see which tools are being used, which are wasting context, or which keep failing.
- **Configuration pain** — Every agent (Cursor, Windsurf, Codex, Claude) uses a different config format and location.

MCP Hub solves these by acting as a single MCP endpoint that aggregates, optimizes, and monitors all your upstream servers.

## Architecture

```
┌─────────────────┐                              ┌──────────────────┐
│  AI Client      │   MCP JSON-RPC over HTTP     │  MCP Hub Gateway │
│  (Cursor, etc.) │ ◄──────────────────────────► │                  │
└─────────────────┘                              │  • Aggregation   │
                                                 │  • Caching       │
                                                 │  • Resilience    │
                                                 │  • Monitoring    │
                                                 │  • Dashboard     │
                                                 └────────┬─────────┘
                          ┌──────────────────────────────┼──────────────────────────────┐
                          ▼                              ▼                              ▼
                  ┌───────────────┐              ┌───────────────┐              ┌───────────────┐
                  │ MCP Server A  │              │ MCP Server B  │              │ MCP Server C  │
                  │ (e.g. GitHub) │              │ (e.g. Postgres)│              │ (e.g. Files)  │
                  └───────────────┘              └───────────────┘              └───────────────┘
```

## What's Completed

### Gateway Core (Phase 1 + Phase 3)

- **Multi-upstream aggregation** — Connects to multiple MCP servers via stdio, merges their `tools/list` responses, and routes `tools/call` to the correct server using a `serverName/toolName` prefix scheme.
- **TTL cache** — Caches `tools/list` per upstream with configurable TTL (default 60s) so repeated requests don't hit upstream servers.
- **Resilience layer** — Per-upstream circuit breakers, configurable retry with exponential backoff, and per-call timeouts to prevent cascading failures.
- **Protocol fixer** — Auto-restarts crashed stdio servers with exponential backoff, normalizes cryptic MCP errors into clear actionable messages, and validates tool schemas on first fetch (logging warnings for missing descriptions, bad types, etc.).
- **Usage monitoring** — Tracks per-server and per-tool metrics (call count, success/failure, average latency, token overhead estimates). Detects dead tools (registered but never called) and error-prone tools. Persists stats to `~/.mcphub/usage.json`.
- **Configuration** — Supports multi-upstream JSON config with Zod validation, plus legacy single-upstream format. Loads from file, env vars, or defaults. Runtime config changes are persisted.

### Management Dashboard

- **React SPA** served directly by the gateway at `/dashboard`.
- **Overview tab** — Server status, circuit breaker states, tool counts, token overhead, top tools at a glance.
- **Servers tab** — Add/remove/toggle/restart upstream servers. Browse and add servers from the MCP server registry (powered by [mcpradar.com](https://mcpradar.com)), or add manually.
- **Tools tab** — Search and browse all merged tools across all servers.
- **Playground tab** — Select any tool, fill in arguments, execute it, and see the response — all from the browser.
- **Stats tab** — Token overhead per server (with bar chart), dead tool report, error-prone tool report, wasted token percentage.

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | POST | MCP JSON-RPC endpoint (single or batch) |
| `/health` | GET | Gateway health, upstream status, circuit states |
| `/stats` | GET | Usage statistics and analysis |
| `/api/upstreams` | GET | List all upstream servers with details |
| `/api/upstreams` | POST | Add a new upstream server |
| `/api/upstreams/:name` | DELETE | Remove an upstream server |
| `/api/upstreams/:name/toggle` | POST | Enable/disable an upstream |
| `/api/upstreams/:name/restart` | POST | Restart an upstream server |
| `/api/tools` | GET | List all merged tools |
| `/api/tools/call` | POST | Call a tool by name |
| `/api/registry/search` | GET | Search the MCP server registry |

## What's Remaining

### Phase 2 — Token-Aware Compression & Budget Cap

- [ ] **Description compressor** — Automatically shorten verbose tool/parameter descriptions to reduce token overhead (rule-based and optional LLM pass).
- [ ] **Token budget cap** — Configurable `max_tool_list_tokens` setting; when the aggregated tool list exceeds the budget, truncate or drop tools by priority.
- [ ] **Compression pipeline** — Per-upstream and global compression stages before returning `tools/list` to the client.

### Phase 4 — Tool Consolidation & Security

- [ ] **Tool consolidation** — Map N similar upstream tools to 1 gateway tool with a `provider` parameter (e.g. `web_search(provider="tavily"|"brave")`), routing internally.
- [ ] **Authentication & authorization** — API key or OAuth at the gateway, per-tool or per-server allowlists per client/tenant.
- [ ] **Per-tool approval flows** — Require manual approval for sensitive tool executions.

### Phase 5 — Observability & Validation

- [ ] **Doctor endpoint** — Validate all upstreams, report reachability, and estimate token usage per server.
- [ ] **Metrics export** — Token size of responses, cache hit rate, latency per upstream (Prometheus/OpenTelemetry compatible).
- [ ] **Discovery API** — Expose available servers and tool counts for external tooling.

### CLI Tool (MCP Hub CLI)

- [ ] **Universal agent support** — `mcphub add <server> --agent cursor|windsurf|cline|codex|all` to install servers across all agents.
- [ ] **Unified registry search** — `mcphub search`, `mcphub browse`, `mcphub info` across all major registries.
- [ ] **Dependency management** — Auto-detect and install npx/uvx/Docker prerequisites.
- [ ] **Config validation** — `mcphub validate` and `mcphub doctor` to check configs before runtime.
- [ ] **Cross-agent sync** — `mcphub sync cursor windsurf` to replicate configs between agents.

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **npm**

### Install Dependencies

```bash
# Install gateway dependencies
cd gateway
npm install

# Install dashboard dependencies
cd dashboard
npm install
cd ..
```

### Configure

Copy the example config and edit it with your upstream MCP servers:

```bash
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "port": 3010,
  "cacheTtlSeconds": 60,
  "resilience": {
    "timeoutMs": 10000,
    "maxRetries": 2,
    "circuitBreakerThreshold": 5,
    "circuitBreakerResetMs": 30000
  },
  "upstreams": [
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
      }
    },
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  ]
}
```

You can also configure via environment variables:

```bash
export MCP_GATEWAY_PORT=3010
export MCP_GATEWAY_UPSTREAM_COMMAND=npx
export MCP_GATEWAY_UPSTREAM_ARGS="-y,@modelcontextprotocol/server-everything"
```

Or point to a config file:

```bash
export MCP_GATEWAY_CONFIG=/path/to/config.json
```

### Build & Run

```bash
# Build everything (gateway + dashboard)
npm run build:all

# Start the gateway
npm start
```

The gateway will be available at:

- `http://localhost:3010/` — MCP JSON-RPC endpoint
- `http://localhost:3010/dashboard` — Management dashboard
- `http://localhost:3010/health` — Health check

### Development Mode

```bash
# Run gateway with hot reload (no build step needed)
npm run dev

# In a separate terminal, run dashboard dev server
cd dashboard
npm run dev
```

### Point Your AI Agent at the Gateway

Configure your agent to use the gateway as its MCP server. For example, in Cursor's `mcp.json`:

```json
{
  "mcpServers": {
    "hub": {
      "url": "http://localhost:3010/"
    }
  }
}
```

Now your agent talks to one endpoint and gets tools from all your configured upstream servers.

## Project Structure

```
mcphub/
├── README.md                        # This file
├── docs/
│   └── MCP_API_GATEWAY_PLAN.md      # Detailed technical plan
├── gateway/
│   ├── package.json                 # Gateway dependencies
│   ├── tsconfig.json                # TypeScript config
│   ├── config.example.json          # Example configuration
│   ├── src/
│   │   ├── index.ts                 # Express server, REST API, entry point
│   │   ├── config.ts                # Config loading & validation (Zod)
│   │   ├── proxy.ts                 # Upstream MCP client management
│   │   ├── aggregate.ts             # Multi-server aggregation & routing
│   │   ├── resilience.ts            # Circuit breaker, retries, timeouts
│   │   ├── cache.ts                 # TTL cache for tools/list
│   │   ├── monitor.ts               # Usage stats, token estimation, dead tool detection
│   │   └── fixer.ts                 # Auto-restart, error normalization, schema validation
│   └── dashboard/
│       ├── package.json             # Dashboard dependencies
│       ├── vite.config.ts           # Vite build config
│       └── src/
│           ├── App.tsx              # Main dashboard UI
│           ├── api.ts               # React Query hooks & API client
│           ├── ServerSearch.tsx      # Registry search component
│           ├── main.tsx             # React entry point
│           └── index.css            # Tailwind styles
```

## License

MIT
