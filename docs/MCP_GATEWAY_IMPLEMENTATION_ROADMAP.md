# MCP API Gateway — Implementation Roadmap (MVP)

A stage-by-stage plan with **testable milestones** and small, doable steps. Each stage ends with a clear way to verify it works before moving on.

---

## Prerequisites (Before Stage 1)

- [ ] Choose runtime: **Node.js + TypeScript** (recommended for MCP SDK ecosystem) or **Python**.
- [ ] Repo structure: create `gateway/` (or `packages/gateway/`) in mcphub with `package.json` / `pyproject.toml`.
- [ ] One **test MCP server** you can run locally (e.g. [MCP time server](https://github.com/modelcontextprotocol/servers/tree/main/src/time), or any small stdio/HTTP server). You’ll point the gateway at it.

---

## Stage 1: Single-Upstream Proxy (Test: client → gateway → one server)

**Goal:** Client talks to the gateway; gateway forwards MCP JSON-RPC to one upstream server. Client sees that server’s tools and can call one.

### Steps

1. **1.1** Create a minimal HTTP server (e.g. Express/Fastify in Node, or FastAPI in Python) that:
   - Listens on a port (e.g. `3010`).
   - Accepts POST with JSON body (raw JSON-RPC or wrapped).

2. **1.2** Implement **stdio transport to upstream**: gateway spawns the upstream MCP server process (or connects to its HTTP URL), sends JSON-RPC messages, reads responses.  
   - Use official **MCP SDK** for your language ([TypeScript](https://github.com/modelcontextprotocol/typescript-sdk), [Python](https://github.com/modelcontextprotocol/python-sdk)) so you get correct message shapes and request/response handling.

3. **1.3** Implement **gateway → client transport**: accept HTTP POST from client, parse JSON-RPC, forward to upstream, return upstream response.  
   - For MVP, **request/response** only (no SSE streaming yet). One request in → one request to upstream → one response back.

4. **1.4** Handle at least these methods by forwarding to upstream and returning the result:
   - `initialize`
   - `tools/list`
   - `tools/call`

5. **1.5** Add a minimal **config** (file or env): upstream command or URL (e.g. `npx -y @modelcontextprotocol/server-time` or `http://localhost:3000`).

### How to test Stage 1

- [ ] Start your test MCP server (e.g. time server).
- [ ] Start the gateway with config pointing at that server.
- [ ] Send `initialize` then `tools/list` to the gateway (e.g. with `curl` or a small script). You should get the same tools as when calling the server directly.
- [ ] Send `tools/call` for one tool (e.g. “get time”) to the gateway. Response should match calling the server directly.

**Deliverable:** Client can use the gateway as a drop-in for one MCP server (list tools, call one tool).

---

## Stage 2: Multi-Server Aggregation (Test: merged tools from 2+ servers)

**Goal:** Gateway connects to **multiple** upstream servers and merges their tools (and optionally resources/prompts) into one response.

### Steps

2. **2.1** Extend config to support **multiple upstreams** (e.g. list of `{ name, command_or_url }`).

2. **2.2** On startup (or on first request), open a connection to each upstream (stdio process or HTTP client per server). Keep references in memory (e.g. map by server name).

2. **2.3** For `initialize`: call each upstream’s `initialize`, then return a **merged** capability object (e.g. union of capabilities). If any upstream fails, you can fail the whole init or return partial (document the choice).

2. **2.4** For `tools/list`: call `tools/list` on **each** upstream, then **merge** the `tools` arrays. Prefix or tag each tool with server name (e.g. `server_a/get_time`) so you can route later. Return `{ tools: [ ...all tools... ] }`.

2. **2.5** For `tools/call`: parse the tool name to determine which upstream owns it (e.g. by prefix or a mapping). Forward `tools/call` to that upstream only; return that upstream’s response.

2. **2.6** (Optional for MVP) Do the same for `resources/list` and `resources/read` if you want resources in the MVP.

### How to test Stage 2

- [ ] Configure gateway with **2** different MCP servers (e.g. time server + one other small server).
- [ ] Call `tools/list` on the gateway. Response must contain tools from **both** servers (with distinct names so you can tell them apart).
- [ ] Call `tools/call` for a tool from server A, then for a tool from server B. Both must succeed and return correct results.

**Deliverable:** One gateway endpoint exposes a single merged list of tools from multiple servers; tool calls are routed to the right server.

---

## Stage 3: Description Compression (Test: token count goes down)

**Goal:** Before returning `tools/list` to the client, shorten tool names/descriptions and parameter descriptions so the response uses fewer tokens.

### Steps

3. **3.1** Add a **token estimator**: function that takes a string or JSON and returns an approximate token count (e.g. `length/4` or use a small tokenizer like `tiktoken` / `gpt-tokenizer`). Use it to measure size of the **raw** merged tool list.

3. **3.2** Implement a **description compressor** (pure function, no LLM):
   - For each tool: trim `description` to a max length (e.g. 100 chars) or first sentence.
   - For each parameter in `inputSchema`: trim `description` to a short phrase (e.g. 20 chars).
   - Optionally remove `examples` from schema if present.
   - Keep `name` and structure; only shorten human-readable text.

3. **3.3** Run the compressor on the merged tool list **before** returning it to the client. Return the compressed list from `tools/list`.

3. **3.4** Log or expose (e.g. response header or debug endpoint) **before/after token estimates** for `tools/list` so you can verify reduction.

### How to test Stage 3

- [ ] Use an upstream that has verbose tools (e.g. a server with long descriptions). Call `tools/list` **without** compression and record token estimate.
- [ ] Enable compression. Call `tools/list` again. Token estimate must be **lower** (aim for ~30–50% reduction as a first goal).
- [ ] Call `tools/call` for a tool — behavior must be unchanged (compression only affects metadata, not execution).

**Deliverable:** Gateway returns a compressed tool list with measurably fewer tokens; tool execution unchanged.

---

## Stage 4: Token Budget Cap (Test: response never exceeds limit)

**Goal:** Gateway enforces a **maximum token count** for the aggregated `tools/list` (and optionally resources/prompts). If over budget, truncate or drop tools until under the cap.

### Steps

4. **4.1** Add config: `max_tool_list_tokens` (e.g. 25_000). If not set, skip cap (current behavior).

4. **4.2** After merging and compressing tools, run the **token estimator** on the full list. If over `max_tool_list_tokens`:
   - Sort tools (e.g. by server order, or by name).
   - Remove tools from the end (or from lowest-priority server) until estimated size ≤ cap.
   - Optionally add a synthetic “meta” tool or message: “N more tools available (omitted for context limit).”

4. **4.3** When **routing** `tools/call`: if the client calls a tool that was **dropped** (not in the list you returned), return a clear JSON-RPC error (e.g. “Tool not in current context window; list was truncated. Retry with fewer upstreams or higher limit.”). Optional: keep a full server-side list and still allow the call if the client somehow sends that tool name (advanced).

4. **4.4** (Optional) Apply the same cap to `resources/list` if you aggregate resources.

### How to test Stage 4

- [ ] Set `max_tool_list_tokens` to a **small** value (e.g. 500). Configure 2 upstreams that together exceed 500 tokens of tools.
- [ ] Call `tools/list`. Response must contain only enough tools to stay under 500 tokens (estimate). Log or header should show “capped.”
- [ ] Call `tools/call` for a tool that **was** included: must succeed.
- [ ] Call `tools/call` for a tool that was **dropped**: must return a clear error (or succeed if you implemented “full list routing” — document which you chose).

**Deliverable:** Configurable token cap on tool list; over-budget lists are truncated; behavior is predictable and testable.

---

## Stage 5: Caching (Test: second request is fast, cache hit)

**Goal:** Cache `tools/list` (and optionally `resources/list`) per upstream so repeated requests don’t hit upstreams every time; response is fast and stable.

### Steps

5. **5.1** Add an in-memory cache (e.g. a Map keyed by `server_id` or `server_id + method`). Store the **compressed** merged result (or per-server compressed list and merge on read).

5. **5.2** For `tools/list`: before calling upstreams, check cache. If all entries are present and not expired, return cached merged list (and optionally skip compression if you cache post-compression). If missing or expired, fetch from upstreams, compress, cap, then **write to cache**.

5. **5.3** Add a simple TTL (e.g. 60 seconds) per cache entry. Config: `cache_ttl_seconds` (0 = disabled).

5. **5.4** (Optional) Invalidate cache when upstream sends a notification that tools changed, if you support notifications. For MVP, TTL is enough.

### How to test Stage 5

- [ ] Enable cache with TTL = 60s. Call `tools/list` twice. Second request should be **faster** (no upstream calls if same process).
- [ ] Log or expose cache hit/miss (e.g. header `X-Cache: HIT` or `MISS`). Second request within TTL should show HIT.
- [ ] After TTL expires, next request should refetch and show MISS.

**Deliverable:** `tools/list` is cached with TTL; repeat calls are faster and produce same result until expiry.

---

## Stage 6 (Optional for MVP): Resilience & Observability

**Goal:** Gateway doesn’t crash when one upstream is slow or down; you can see what’s happening.

### Steps

6. **6.1** **Retries:** For `tools/list` and `tools/call`, if an upstream returns error or timeout, retry up to N times (e.g. 2) with a short backoff. Only retry for safe methods (e.g. don’t retry `tools/call` if you later add side-effect semantics).

6. **6.2** **Timeouts:** Set a timeout (e.g. 10s) for each upstream call. Return a clear JSON-RPC error on timeout.

6. **6.3** **Circuit breaker (simple):** If an upstream fails M times in a row, mark it “open” for K seconds; during that time skip it in aggregation and return a partial list (or error). After K seconds, try again.

6. **6.4** **Health / doctor endpoint:** GET `/health` or POST JSON-RPC `gateway/status` that lists upstreams and their status (e.g. “ok”, “timeout”, “circuit open”). No auth required for MVP.

### How to test Stage 6

- [ ] Stop one upstream. Call `tools/list` — gateway should return tools from the other server(s) and optionally mark the failed one in status.
- [ ] Call `tools/call` for a tool on the stopped server — should get a clear error.
- [ ] Hit `/health` or `gateway/status` and see which upstreams are up/down.

**Deliverable:** One failing upstream doesn’t take down the gateway; you can inspect status.

---

## MVP Definition (When to stop)

You have an **MVP** when:

- [ ] **Stage 1** done: single-upstream proxy works.
- [ ] **Stage 2** done: multi-server aggregation works.
- [ ] **Stage 3** done: description compression reduces token count.
- [ ] **Stage 4** done: token budget cap is enforced.
- [ ] **Stage 5** done: caching works with TTL.

Stages 6 (resilience) and beyond (auth, consolidation, lazy loading) can be post-MVP.

---

## Quick Reference: Test Checklist by Stage

| Stage | What to test |
|-------|------------------|
| 1 | `initialize` → `tools/list` → `tools/call` through gateway to 1 server; same result as direct. |
| 2 | `tools/list` returns merged tools from 2+ servers; `tools/call` routes to correct server. |
| 3 | Token estimate for `tools/list` drops with compression; `tools/call` still works. |
| 4 | With low `max_tool_list_tokens`, list is truncated; call to included tool works; call to omitted tool fails clearly. |
| 5 | Second `tools/list` within TTL is fast and cache HIT. |
| 6 | One upstream down → partial list or error; health shows status. |

---

## Suggested Repo Layout (gateway)

```
gateway/
├── package.json          # or pyproject.toml
├── src/
│   ├── index.ts          # HTTP server entry
│   ├── proxy.ts          # forward JSON-RPC to upstream(s)
│   ├── aggregate.ts      # merge tools/list, resources/list
│   ├── compress.ts       # description compression
│   ├── token-estimate.ts # token counter
│   ├── cap.ts            # apply max_tool_list_tokens
│   ├── cache.ts          # in-memory cache
│   └── config.ts         # load config
├── config.example.json   # example upstreams + options
└── scripts/
    └── test-gateway.sh   # curl or small script to hit initialize, tools/list, tools/call
```

You can add a **simple test script** (e.g. `scripts/test-gateway.sh` or a Jest/Vitest test) that runs after each stage to automate the checks above.
