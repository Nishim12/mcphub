# MCP API Gateway — Development Plan

A plan to build an MCP API Gateway that addresses issues people face with MCP in production, with a focus on **token/context size limits** and related problems.

---

## 1. Problems People Have Online (Summary)

| Category | Issue | Source / Impact |
|----------|--------|------------------|
| **Context / token bloat** | MCP tools + resources consume 50k–80k+ tokens before any conversation; single servers (e.g. mcp-omnisearch) can use 14k+ tokens with ~20 tools. | [Scott Spence](https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code); Claude Code `/context` and `/doctor` |
| **Configuration fragmentation** | Different config files/formats per agent (Cursor, Windsurf, Codex, Claude, etc.). | mcphub README; community |
| **Poor errors & debugging** | “MCP server won’t load”, obscure errors, no pre-runtime validation. | mcphub README |
| **Discovery chaos** | Many registries (MCP.so, GitHub, MCPdb, Awesome MCP); no unified view or quality signal. | mcphub README |
| **Security & governance** | Uncontrolled tool execution, no central auth/authz, unclear permissions. | [Windsurf security](https://embracethered.com/blog/posts/2025/windsurf-dangers-lack-of-security-controls-for-mcp-server-tool-invocation/); Gravitee |
| **Scalability & reliability** | No central routing, retries, circuit breaking, or caching when talking to many MCP servers. | [Gravitee MCP Gateway](https://www.gravitee.io/blog/mcp-api-gateway-explained-protocols-caching-and-remote-server-integration) |
| **Cognitive overload** | Too many similar tools (10–20+) lead to confusion, wrong tool choice, hallucinated tool names. | Scott Spence; LLM tool-selection studies |

The gateway can address all of these; the **token size limit** is the one that most directly affects “will my agent even fit in the context window?”

---

## 2. Token Size Limit: What’s Going On

### 2.1 Why MCP Blows Up Context

- **Hosts (Cursor, Claude Code, etc.)** must load **all** tools and often resource metadata at startup or when building the prompt.
- Each MCP server exposes:
  - **Tools**: name, description, parameters (with descriptions), sometimes examples → **hundreds of tokens per tool**.
  - **Resources**: list of URIs and metadata → more tokens.
  - **Prompts**: template list and content → more tokens.
- This is sent to the LLM as **system/context**. So:
  - 10 servers × ~7k tokens each ≈ **70k tokens** before the user says anything.
  - With a 200k window, that’s ~35% gone; with many servers, 50%+ is common.

So the “token size limit” issue with MCPs is: **the sum of tools + resources + prompts from all connected MCP servers often exceeds a reasonable share of the model’s context window**, leaving little room for conversation and actual task context.

### 2.2 Root Causes

1. **Verbose tool definitions** — Long descriptions, many parameters with long descriptions, examples.
2. **Too many tools per server** — Many small, similar tools instead of fewer tools with parameters (e.g. 4 search tools → 1 `web_search(provider)`).
3. **No gateway-level filtering** — Client gets “everything” from every server; no truncation, summarization, or on-demand loading.
4. **Aggregation without optimization** — When a gateway aggregates multiple servers, it often just concatenates all tools/resources, making the problem worse unless the gateway explicitly reduces token usage.

---

## 3. How to Fix the Token Size Limit (Gateway-Centric)

An **MCP API Gateway** can fix or mitigate this in several ways.

### 3.1 Gateway as Single MCP Endpoint (Aggregation + Reduction)

- **Idea:** The AI client talks to **one** MCP “server” (the gateway). The gateway talks to many upstream MCP servers.
- **Token fix:** The gateway does **not** blindly forward `tools/list` (and similar). It:
  - Fetches tools/resources from upstreams.
  - **Transforms** them (shorten descriptions, merge similar tools, drop optional fields).
  - Optionally **filters** by user/tenant policy (only expose a subset of tools).
  - Returns a **single, reduced** tool/resource set to the client.

So the “token size limit” is addressed by **curating and compressing** what the client ever sees.

### 3.2 Tool List Compression (Descriptions & Schemas)

- **Shorten descriptions:**  
  e.g. “Search the web using Tavily Search API. Best for factual queries requiring reliable sources…” → “Search using Tavily. Best for factual/academic topics with citations.”
- **Shorten parameter descriptions:**  
  “The maximum number of search results to return from the API call” → “Result limit.”
- **Remove or shorten examples** in tool schemas when they’re not essential.
- **Implementation:** Gateway can run a **compression pipeline** on each upstream `tools/list` response (regex/LLM/rule-based) before merging and returning to the client.

This directly reduces tokens per tool (e.g. 710 → ~200 tokens per tool in reported cases).

### 3.3 Tool Consolidation at the Gateway

- **Problem:** Many servers expose 10–20+ similar tools (e.g. `tavily_search`, `brave_search`, `kagi_search`).
- **Fix:** Gateway can **map** multiple upstream tools to **one** logical tool with a `provider` (or `mode`) parameter and forward `tools/call` to the right upstream by provider.
- **Result:** Fewer tools in the list → fewer tokens and less cognitive overload for the model.

You can do this either:
- **At the gateway** (gateway exposes e.g. `web_search(provider, query, limit)` and routes to the right server), or
- **By recommending/automating server-side consolidation** (gateway could host a “best practice” transformer that suggests or applies consolidation rules for known servers).

### 3.4 On-Demand / Lazy Tool Loading (Advanced)

- **Idea:** Don’t send the full tool list in the first prompt. Send a **short catalog** (name + one-line description). When the model (or the client) needs details for a tool, it requests that tool’s full schema.
- **Challenge:** Standard MCP and many hosts assume “all tools listed up front.” So this requires either:
  - Host support for “lazy tools,” or
  - Gateway exposing a **two-phase** flow: first respond with a minimal list; on first `tools/call` for a tool, gateway fetches full schema from upstream and caches it (and optionally injects a “tool schema” resource for the host to use in next turn).

This is a more invasive but high-impact way to stay under token limits when you have many servers.

### 3.5 Cap / Quota Per Client or Session

- **Idea:** Gateway enforces a **max token budget** for the aggregated `tools/list` (+ optionally `resources/list`, `prompts/list`) response.
- **Mechanism:**  
  - Estimate tokens (e.g. by character count / 4 or using a small tokenizer).  
  - Sort tools (e.g. by priority or usage).  
  - Truncate or drop tools (or whole servers) until under the cap.  
  - Optionally return metadata like “X more tools available on demand” so the host can ask for more if needed.
- **Result:** Context size is bounded regardless of how many servers are registered.

### 3.6 Caching and Freshness (Indirect Help)

- **Cache** `tools/list` (and resource list) per upstream server with a short TTL so you don’t refetch on every connection.
- **Precompute** the compressed/merged view so the client gets a fast, small response.
- This doesn’t reduce tokens by itself but makes “always serve a compressed list” cheap and predictable.

### 3.7 Summary: Token Fix Strategy for the Gateway

| Approach | What the gateway does | Effect on token limit |
|----------|------------------------|------------------------|
| **Compress descriptions** | Shorten tool/resource descriptions and param text before sending to client | Large per-tool reduction (e.g. 60% in reported cases) |
| **Consolidate tools** | Expose fewer logical tools (e.g. one `web_search(provider)`) and route internally | Fewer tools → large token and cognitive load reduction |
| **Filter / allowlist** | Expose only a subset of servers or tools per client/tenant | Direct cap on tokens |
| **Token budget cap** | Truncate or drop tools until estimated size &lt; budget | Hard guarantee on max context used by MCP |
| **Lazy loading** (if host supports) | Return minimal list first; full schema on demand | Minimal upfront tokens; pay only for what’s used |
| **Cache compressed list** | Cache the compressed/merged tool list per server/session | Stable, fast, and keeps token footprint low over time |

Recommended **first phases** for the gateway:  
**(1)** Aggregation + **description compression** + **(2)** optional **per-client token budget cap**.  
Then add **(3)** tool consolidation rules for known high-impact servers.

---

## 4. MCP API Gateway: Scope and Features

### 4.1 Core Role

- Sit **between** AI clients (Cursor, Claude Code, custom apps) and **one or many** MCP servers.
- Expose **one** MCP endpoint to the client (optionally one per tenant).
- Handle routing, auth, and **context/token control** as above.

### 4.2 Feature List (Aligned to “Issues People Have”)

| Feature | Addresses |
|--------|-----------|
| **Single endpoint / aggregation** | Fragmentation, many configs; client configures one “gateway” URL |
| **Tool/resource list compression** | **Token size limit** (main fix) |
| **Tool consolidation (e.g. by provider)** | Token limit + cognitive overload |
| **Token budget cap for tool list** | Token size limit (hard guarantee) |
| **Caching (tools/list, resources/list, prompts/list)** | Performance, reliability (Gravitee-style) |
| **Authn / Authz** | Security blindspots; central place for API keys, OAuth, per-tool approval |
| **Routing + retries + circuit breaker** | Reliability when servers are slow or down |
| **Validation / doctor endpoint** | Poor errors; gateway can validate upstreams and report clear errors |
| **Discovery metadata** | Optional: gateway can expose “which servers/tools are available” for mcphub or UIs |

### 4.3 Out of Scope (Handled Elsewhere)

- **Agent-specific config files** (Cursor vs Windsurf vs Codex) → remain in **mcphub CLI** (discovery, install, validate, `mcp.json` / `config.toml`).
- **Installing runtimes** (npx, uvx) → mcphub.
- **Unified registry search** → mcphub.

So: **Gateway = runtime layer (protocol, routing, security, token control)**. **mcphub = setup and config layer.**

---

## 5. High-Level Architecture

```
┌─────────────────┐     MCP (HTTP/SSE or stdio)      ┌──────────────────┐
│  AI Client      │ ◄──────────────────────────────► │  MCP API Gateway │
│  (Cursor, etc.) │   compressed tools/resources    │                  │
└─────────────────┘                                  │  • Authn/Authz   │
                                                     │  • Compress      │
                                                     │  • Consolidate   │
                                                     │  • Token cap     │
                                                     │  • Cache         │
                                                     │  • Route         │
                                                     └────────┬─────────┘
                                                              │
                    ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
                    │ MCP (stdio/HTTP)                         │                                         │
                    ▼                                         ▼                                         ▼
            ┌───────────────┐                         ┌───────────────┐                         ┌───────────────┐
            │ MCP Server A  │                         │ MCP Server B  │                         │ MCP Server C  │
            │ (e.g. search) │                         │ (e.g. DB)     │                         │ (e.g. files)  │
            └───────────────┘                         └───────────────┘                         └───────────────┘
```

### 5.1 Data Flow for Token Reduction

1. Client calls gateway: `initialize`, then `tools/list`.
2. Gateway (with cache) gets `tools/list` from each upstream (or from cache).
3. Gateway **compresses** descriptions, **consolidates** where configured, **filters** by policy, **caps** by token budget.
4. Gateway returns **one** merged, size-limited `tools/list` to the client.
5. On `tools/call`, gateway routes to the correct upstream (and, if consolidation is used, maps `provider` → server/tool).

---

## 6. Implementation Phases

### Phase 1: Proxy + aggregation (no token logic yet)

- Implement MCP JSON-RPC proxy: client ↔ gateway ↔ one or more upstream MCP servers.
- Support at least one transport (e.g. streamable HTTP/SSE).
- Aggregate `tools/list`, `resources/list`, `prompts/list` from multiple servers and return merged result.
- Basic routing for `tools/call`, `resources/read`, etc. to the right server.

### Phase 2: Token-aware compression and cap

- Add **description compressor** (rules + optional LLM pass) for tool names, descriptions, parameter descriptions.
- Add **token estimator** (e.g. chars/4 or tiktoken) for the aggregated response.
- Add **configurable token budget** for tool/resource list; when over budget, truncate or drop tools (by priority or round-robin per server).
- Expose config: `max_tool_list_tokens`, `compress_descriptions: true`, etc.

### Phase 3: Caching and resilience

- Cache `tools/list`, `resources/list`, `prompts/list` per upstream (TTL, invalidation on notification if needed).
- Retries and circuit breaker for upstream calls.
- Optional: cache `resources/read` for static URIs (as in Gravitee).

### Phase 4: Consolidation and security

- **Tool consolidation:** Configurable mapping of N upstream tools → 1 gateway tool (e.g. “web_search” with `provider`); route `tools/call` by provider.
- **Authn/Authz:** API key or OAuth at gateway; optional per-tool or per-server allowlist per client/tenant.

### Phase 5: Observability and validation

- **Doctor endpoint:** Gateway validates all upstreams, reports which are reachable, and estimates token usage per server.
- **Metrics:** Token size of responses, cache hit rate, latency per upstream.
- Optional: **Discovery API** for mcphub (list of servers and tool counts through the gateway).

---

## 7. Success Criteria

- **Token limit:** With the gateway in front of N servers that would normally send e.g. 80k tokens of tools, the client receives &lt; 25k tokens (configurable), with no loss of essential functionality.
- **Reliability:** Upstream failures don’t take down the gateway; circuit breaker and timeouts in place.
- **Security:** All calls to upstreams go through the gateway with central auth and optional approval for sensitive tools.
- **Compatibility:** Any MCP client that can point at an MCP server URL can point at the gateway instead.

---

## 8. References

- [Optimising MCP Server Context Usage in Claude Code (Scott Spence)](https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code) — token bloat, consolidation, short descriptions.
- [MCP API Gateway (Gravitee)](https://www.gravitee.io/blog/mcp-api-gateway-explained-protocols-caching-and-remote-server-integration) — protocols, caching, remote servers, what to cache.
- [MCP Specification (2024-11-05)](https://modelcontextprotocol.io/specification/2024-11-05) — JSON-RPC, tools, resources, prompts, transports.
- mcphub README — configuration fragmentation, discovery, validation, security (complementary to gateway).

---

## 9. Next Steps

- **Implementation roadmap:** For a stage-by-stage MVP with testable steps, see **[MCP_GATEWAY_IMPLEMENTATION_ROADMAP.md](./MCP_GATEWAY_IMPLEMENTATION_ROADMAP.md)**.

1. **Decide placement:** Same repo as mcphub (e.g. `mcphub/gateway`) or separate repo with a reference to mcphub for “setup.”
2. **Choose stack:** e.g. TypeScript/Node (align with MCP SDK) or Go/Rust for a single binary; consider streamable HTTP/SSE support from day one.
3. **Spike:** Minimal proxy that aggregates two upstream MCP servers’ `tools/list` and returns merged result; then add a simple description trimmer and token estimator to validate token reduction.
4. **Document:** Add “When to use the gateway” to mcphub README (e.g. “Use mcphub to install and configure; use the gateway when you have many servers or need to control context size and security.”).

This plan gives you a clear path to an MCP API Gateway that directly addresses the token size limit and the other issues people have with MCP online.
