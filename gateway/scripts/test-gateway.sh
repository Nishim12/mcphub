#!/usr/bin/env bash
# Manual test script for MCP Gateway Stage 1
# Run: ./scripts/test-gateway.sh
# Prerequisites: Gateway running (npm run dev) on port 3010

set -e
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3010}"

echo "=== MCP Gateway Stage 1 - Manual Test ==="
echo "Gateway URL: $GATEWAY_URL"
echo ""

# 1. Health check
echo "1. GET /health"
curl -s "$GATEWAY_URL/health" | jq .
echo ""

# 2. Initialize
echo "2. POST initialize"
INIT_RESP=$(curl -s -X POST "$GATEWAY_URL/" \
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
  }')
echo "$INIT_RESP" | jq .
echo ""

# 3. Tools list
echo "3. POST tools/list"
TOOLS_RESP=$(curl -s -X POST "$GATEWAY_URL/" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }')
TOOL_COUNT=$(echo "$TOOLS_RESP" | jq '.result.tools | length')
echo "Tools count: $TOOL_COUNT"
echo "$TOOLS_RESP" | jq -r '.result.tools[0:3] | .[] | .name'
echo ""

# 4. Call get-sum tool (simple, no special args)
echo "4. POST tools/call (get-sum)"
FIRST_TOOL="get-sum"
CALL_RESP=$(curl -s -X POST "$GATEWAY_URL/" \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 3,
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"$FIRST_TOOL\",
      \"arguments\": {\"a\": 5, \"b\": 3}
    }
  }")
echo "$CALL_RESP" | jq .
echo ""

echo "=== All tests completed ==="
