#!/usr/bin/env bash
# Manual test script for MCP Gateway (Stage 2 — multi-upstream)
# Run: ./scripts/test-gateway.sh
# Prerequisites: Gateway running (npm run dev) on port 3010

set -e
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3010}"

echo "=== MCP Gateway — Manual Test ==="
echo "Gateway URL: $GATEWAY_URL"
echo ""

# 1. Health check (now shows per-upstream status)
echo "1. GET /health"
curl -s "$GATEWAY_URL/health" | jq .
echo ""

# 2. Initialize (now returns merged capabilities + _gateway metadata)
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

# 3. Tools list (tools are prefixed with "serverName/" when multi-upstream)
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
echo "First 5 tools:"
echo "$TOOLS_RESP" | jq -r '.result.tools[0:5] | .[] | .name'
echo ""

# 4. Call a tool
echo "4. POST tools/call"
# When single upstream, tools are NOT prefixed (backward compat).
# When multi-upstream, use "serverName/toolName" format.
# Detect from the first tool name in the list.
FIRST_TOOL=$(echo "$TOOLS_RESP" | jq -r '.result.tools[0].name')
echo "   Calling first tool: $FIRST_TOOL"

# Try to find a simple tool to call. Use echo tool if available.
ECHO_TOOL=$(echo "$TOOLS_RESP" | jq -r '.result.tools[] | select(.name | test("echo")) | .name' | head -1)
if [ -n "$ECHO_TOOL" ]; then
  echo "   Found echo tool: $ECHO_TOOL"
  CALL_RESP=$(curl -s -X POST "$GATEWAY_URL/" \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": 3,
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"$ECHO_TOOL\",
        \"arguments\": {\"message\": \"Hello from gateway test!\"}
      }
    }")
  echo "$CALL_RESP" | jq .
else
  # Fallback: call get-sum if available
  SUM_TOOL=$(echo "$TOOLS_RESP" | jq -r '.result.tools[] | select(.name | test("sum")) | .name' | head -1)
  if [ -n "$SUM_TOOL" ]; then
    echo "   Found sum tool: $SUM_TOOL"
    CALL_RESP=$(curl -s -X POST "$GATEWAY_URL/" \
      -H "Content-Type: application/json" \
      -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 3,
        \"method\": \"tools/call\",
        \"params\": {
          \"name\": \"$SUM_TOOL\",
          \"arguments\": {\"a\": 5, \"b\": 3}
        }
      }")
    echo "$CALL_RESP" | jq .
  else
    echo "   No echo or sum tool found; skipping tools/call test."
  fi
fi
echo ""

echo "=== All tests completed ==="
