#!/bin/bash
# HomeExchange MCP — Keep-alive cron script
# Refreshes the token via the MCP server every hour to prevent PHPSESSID expiration.
#
# Install:
#   crontab -e
#   0 * * * * /mnt/GIT/_mcp/homeexchange-mcp/bin/keep-alive.sh >> /tmp/he-keep-alive.log 2>&1
#
# The PHPSESSID is a server-side PHP session that expires after ~2h of inactivity.
# By calling refresh every hour, we keep it alive indefinitely.
# The BFF stores the refresh_token server-side (linked to PHPSESSID), so only
# PHPSESSID is needed in cookies — no refresh_token cookie required.

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE:-node}"
CACHE_FILE="$HOME/.homeexchange-mcp-tokens.json"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Keep-alive check"

# Check if cache file exists
if [ ! -f "$CACHE_FILE" ]; then
    echo "  No cache file found at $CACHE_FILE — skipping"
    exit 0
fi

# Check if sessionCookie exists in cache
SESSION=$(python3 -c "import json; d=json.load(open('$CACHE_FILE')); print(d.get('sessionCookie',''))" 2>/dev/null)
if [ -z "$SESSION" ]; then
    echo "  No PHPSESSID in cache — skipping"
    exit 0
fi

# Call the MCP server's he_refresh_token tool which:
# - Sends stored cookies to GET /authentication/refresh
# - Captures Set-Cookie headers (new PHPSESSID, new oidc_access_token)
# - Updates ~/.homeexchange-mcp-tokens.json automatically
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"keepalive","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"he_refresh_token","arguments":{}}}' | \
timeout 30 "$NODE" "$SCRIPT_DIR/dist/index.js" 2>/dev/null | \
grep '"id":2' | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.readline())
    c = json.loads(d['result']['content'][0]['text'])
    if c.get('success'):
        print(f\"  Token refreshed successfully, expires: {c.get('expiresAt','?')[:19]}\")
    else:
        print(f\"  Refresh failed: {c.get('message','unknown error')}\")
        print('  -> Re-inject cookies from browser via he_set_cookies')
except Exception as e:
    print(f'  MCP call failed: {e}')
    print('  -> Re-inject cookies from browser via he_set_cookies')
" 2>/dev/null
