<div align="center">

# HomeExchange MCP

**MCP server for [HomeExchange](https://www.homeexchange.com) — browse listings, manage your calendar, send messages and track exchanges from your AI assistant, in natural language.**

[![License: MIT](https://img.shields.io/github/license/manganate006/homeexchange-mcp)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.26%2B-purple)

**[Installation](#installation) · [Tools](#tools) · [Examples](#examples) · [Limitations](#limitations) · [🇫🇷 Français](README.fr.md)**

</div>

## Overview

This [MCP](https://modelcontextprotocol.io) server exposes the HomeExchange platform as **52 tools** your assistant can call. Ask in natural language, it executes:

> **You:** Find houses in Mallorca available Aug 5–19 with a pool and at least 2 bedrooms, then show my unread conversations.
>
> **Assistant:** *(calls `he_search_homes`, then `he_get_conversations`)*
> 7 matching homes in Mallorca — top pick: a verified 3-bedroom villa with pool, 92 % response rate.
> You have 2 unread conversations: Marta (Palma) and Lluís (Sóller).

## Requirements

- **Node.js ≥ 18**
- A **HomeExchange** account with an active subscription
- Any **MCP client** — Claude Code, Claude Desktop, Cursor, Windsurf…

## Installation

Not published to npm — run from the local bundle:

```bash
git clone https://github.com/manganate006/homeexchange-mcp
cd homeexchange-mcp
npm install && npm run bundle   # → dist/bundle.js
```

### Claude Code

```bash
claude mcp add homeexchange \
  --env HE_ACCESS_TOKEN=your_token \
  -- node /absolute/path/to/homeexchange-mcp/dist/bundle.js
```

### Claude Desktop / Cursor

Add to `claude_desktop_config.json` (or your client's MCP config):

```json
{
  "mcpServers": {
    "homeexchange": {
      "command": "node",
      "args": ["/absolute/path/to/homeexchange-mcp/dist/bundle.js"],
      "env": { "HE_ACCESS_TOKEN": "eyJ..." }
    }
  }
}
```

## Authentication

> ⚠️ **No automated login.** HomeExchange uses Auth0 with AWS WAF CAPTCHA + Cloudflare Turnstile, which block automated sessions. You paste a token from your browser once.

1. Log in to [homeexchange.com](https://www.homeexchange.com)
2. DevTools → **Application → Cookies → `homeexchange.com`**
3. Copy the value of **`oidc_access_token`** → set it as `HE_ACCESS_TOKEN`

The token lasts **~24 h** and is cached at `~/.homeexchange-mcp-tokens.json`. Provide the full cookie string via `HE_COOKIES` (including `PHPSESSID`) to enable **automatic renewal** — no manual step afterwards.

| Variable | Required | Purpose |
|---|---|---|
| `HE_ACCESS_TOKEN` | one auth method* | JWT from the `oidc_access_token` cookie |
| `HE_COOKIES` | one auth method* | Full cookie string; enables auto-renewal if `PHPSESSID` is included |

\* At least one of `HE_ACCESS_TOKEN` / `HE_COOKIES`, or inject at runtime with `he_set_tokens`. Rate-limit tuning (`HE_READ_DELAY`, `HE_WRITE_DELAY`, `HE_MESSAGE_DELAY`, `HE_WEB_VERSION`) and the full auth priority: see **[docs/TOOLS.md](docs/TOOLS.md#configuration)**.

## Tools

52 tools, `he_` prefix. Summary by domain — full parameters in **[docs/TOOLS.md](docs/TOOLS.md)**.

| Domain | Tools | Examples |
|---|---|---|
| 🏠 Properties | 9 | `he_get_home`, `he_get_calendar`, `he_update_calendar` |
| 👤 Users | 3 | `he_get_user`, `he_get_user_ratings` |
| ❤️ Favorites | 7 | `he_get_favorites`, `he_add_favorite`, `he_create_wishlist` |
| 💬 Conversations & messages | 14 | `he_get_conversations`, `he_send_message`, `he_send_first_message` |
| 🔄 Exchanges | 8 | `he_get_my_exchanges`, `he_change_exchange_type`, `he_rate_home` |
| 🔍 Search & subscription | 7 | `he_search_homes`, `he_get_saved_searches` |
| 🔐 Auth utilities | 4 | `he_auth_status`, `he_set_tokens` |

## Examples

- "Search houses in Mallorca available August 5–19 with pool and 2+ bedrooms"
- "Show my unread conversations"
- "Translate the last message from conversation 12345 to French"
- "Mark my calendar unavailable July 15 – August 20"
- "First-contact the owner of home 98765 for Sept 1–8, 4 guests"
- "Switch the exchange in conversation 11111 to reciprocal"

## Limitations

- **Manual token** every ~24 h, unless `PHPSESSID` auto-renewal is configured
- **No image upload** for property/profile photos (multipart not implemented yet)
- **No property creation** — `POST /v1/homes` is not exposed
- Conversation pagination is handled client-side (the v3 API ignores the `after` cursor)

## Development

```bash
npm run dev      # tsc watch
npm run build    # compile TypeScript
npm run bundle   # single-file dist/bundle.js (fast startup)
npx @modelcontextprotocol/inspector node dist/bundle.js
```

Full tool reference, search-filter format and architecture: **[docs/TOOLS.md](docs/TOOLS.md)**.

## License

[MIT](LICENSE)
