#!/bin/bash
# HomeExchange MCP \u2014 Keep-alive cron script
# Refreshes the token via stored cookies every hour to prevent session expiration.
#
# Install:
#   crontab -e
#   0 * * * * /mnt/GIT/_mcp/homeexchange-mcp/bin/keep-alive.sh >> /tmp/he-keep-alive.log 2>&1

CACHE_FILE="$HOME/.homeexchange-mcp-tokens.json"

echo "$(date '+%Y-%m-%d %H:%M:%S') \u2014 Keep-alive check"

if [ ! -f "$CACHE_FILE" ]; then
    echo "  No cache file \u2014 skipping"
    exit 0
fi

SESSION=$(python3 -c "import json; d=json.load(open('$CACHE_FILE')); print(d.get('sessionCookie',''))" 2>/dev/null)
if [ -z "$SESSION" ]; then
    echo "  No session cookies in cache \u2014 skipping"
    exit 0
fi

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Cookie: $SESSION" \
    -H "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
    -H "Referer: https://www.homeexchange.fr/" \
    -H "accept: application/json, text/plain, */*" \
    "https://bff.homeexchange.com/authentication/refresh" 2>/dev/null)

if [ "$RESPONSE" = "200" ]; then
    echo "  \u2713 Refresh successful (HTTP 200) \u2014 session kept alive"
else
    echo "  \u2717 Refresh failed (HTTP $RESPONSE) \u2014 session may have expired"
    echo "  \u2192 Re-inject cookies from browser via he_set_cookies"
fi
