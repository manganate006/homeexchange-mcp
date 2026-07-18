# HomeExchange MCP — Tool reference

Full parameters for all 52 tools, configuration, the search-filter format and the architecture.
Back to the [README](../README.md).

## Configuration

### `.mcp.json` (project-level)

```json
{
  "mcpServers": {
    "homeexchange": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/homeexchange-mcp/dist/bundle.js"],
      "timeout": 60000,
      "env": {
        "HE_ACCESS_TOKEN": "eyJ..."
      }
    }
  }
}
```

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HE_ACCESS_TOKEN` | No* | — | JWT bearer token (`oidc_access_token` cookie) |
| `HE_REFRESH_TOKEN` | No | — | Refresh token for session renewal |
| `HE_COOKIES` | No* | — | Raw `document.cookie` string from the browser |
| `HE_READ_DELAY` | No | `500` | Delay between read (GET) requests (ms) |
| `HE_WRITE_DELAY` | No | `2000` | Delay between write requests (ms) |
| `HE_MESSAGE_DELAY` | No | `60000` | Minimum delay between message sends (ms) |
| `HE_REQUEST_DELAY` | No | — | Legacy: sets both read and write delay if the new vars aren't set |
| `HE_WEB_VERSION` | No | `19.7.2` | HomeExchange web version header |

\* At least one auth method required (`HE_ACCESS_TOKEN`, `HE_COOKIES`, or runtime `he_set_tokens`).

### Authentication priority

| Priority | Method | Description |
|----------|--------|-------------|
| 1 | `HE_ACCESS_TOKEN` env var | Recommended — paste token from browser |
| 2 | `HE_COOKIES` env var | Full cookie string from DevTools — enables auto-renewal if `PHPSESSID` is included |
| 3 | Disk cache | `~/.homeexchange-mcp-tokens.json` (auto-used if valid, auto-refreshed if PHPSESSID stored) |
| 4 | Runtime | Call `he_set_tokens` or `he_set_cookies` tool |

## Tools (52)

### 🏠 Properties (6 read)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_get_home` | `homeId`, `locale?` | Full property details: location, features, photos, owner, descriptions. `locale` keeps a single description language (flagged `is_fallback` if missing) |
| `he_get_home_descriptions` | `homeId`, `locales?` | Description texts by language, compact (default `["fr", "en"]`); flags `is_fallback` when a language has no translation |
| `he_get_calendar` | `homeId` | Availability calendar (available / unavailable / maybe periods) |
| `he_get_calendar_batch` | `homeIds[]` | Calendars for multiple homes in one call (max 20) |
| `he_get_ratings` | `homeId` | Property reviews: cleanliness, expectations, communication, feedback |
| `he_get_my_homes` | — | All properties owned by the authenticated user |

### 👤 Users (3)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_get_user` | `userId` | User profile: name, verified status, exchange count, response rate |
| `he_get_user_achievements` | `userId` | GuestPoints loyalty level and achievement badges |
| `he_get_user_ratings` | `userId`, `limit?` | Reviews about a user (as host and guest) |

### ❤️ Favorites (5 read)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_get_favorites` | — | List of favorited property IDs |
| `he_get_favorites_full` | `page?`, `limit?` | Favorites with full property details (paginated) |
| `he_get_wishlists` | `page?`, `limit?` | Favorite folders / collections |
| `he_get_who_favorited_me` | `homeId`, `page?`, `limit?` | Users who favorited one of your properties |
| `he_create_wishlist` | `name` | Create a new favorites folder |

### 💬 Conversations & Messages (8 read)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_get_conversations` | `filter?`, `first?`, `after?` | Conversations list with pagination and filters (`ALL`, `UNREAD`, `ARCHIVED`…) |
| `he_get_conversation` | `conversationId` | Detailed conversation info (participants, exchanges) |
| `he_get_conversation_stats` | — | Stats: unread count, total count |
| `he_get_messages` | `conversationId`, `limit?`, `offset?` | Messages from a conversation (paginated) |
| `he_translate_message` | `messageId`, `targetLanguage` | Translate a single message (e.g. `fr`, `en`, `es`) |
| `he_translate_messages_batch` | `messageIds[]`, `targetLanguage` | Translate multiple messages at once |
| `he_search_conversations` | `query` | Search conversations by keyword |
| `he_get_messages_config` | — | Messaging configuration and templates |

### 🔄 Exchanges (2 read)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_get_my_exchanges` | `filter?`, `limit?`, `offset?` | My exchanges (`upcoming` / `ongoing` / `past`) |
| `he_get_cancellation_reasons` | — | Valid reasons for cancelling an exchange |

### 🔍 Search & Subscription (5 read)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_search_homes` | `filters`, `offset?`, `limit?`, `min_response_rate?` | Search properties (location bounds, dates, bedrooms, amenities…) |
| `he_get_saved_searches` | — | All saved searches |
| `he_get_saved_search` | `searchId` | Details of a specific saved search |
| `he_get_last_searches` | — | Recent search history |
| `he_get_subscription` | — | Subscription plan info (type, expiry, auto-renew) |

### ✉️ Write — Messages (2)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_send_message` | `conversationId`, `content` | Send a message in an existing conversation |
| `he_send_first_message` | `receiverId`, `homeId`, `content`, `startOn`, `endOn`, `nbGuest`, `exchangeType?`, `senderHomeId?` | First contact with a property owner (creates a new conversation). Pre-flight checks calendar availability. |

### 📅 Write — Properties (3)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_update_calendar` | `homeId`, `periods[]` | Set periods: `status` 1=available, 2=unavailable, 3=maybe |
| `he_update_home` | `homeId`, `fields` | Update property details (capacity, min nights, features…) |
| `he_update_description` | `homeId`, `title?`, `good_feature?`, `good_place?`, `other?`, `locale?` | Update property description texts. Omitted fields are preserved (merged from the current values of the target locale); `locale` creates/updates a language version |

### Write — Favorites (2)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_add_favorite` | `homeId`, `wishlistId?` | Add to favorites (optionally in a wishlist) |
| `he_remove_favorite` | `homeId` | Remove from favorites |

### Write — Conversations (4)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_archive_conversation` | `conversationId` | Archive a conversation |
| `he_unarchive_conversation` | `conversationId` | Unarchive a conversation |
| `he_favorite_conversation` | `conversationId`, `favorite?` | Star / unstar a conversation |
| `he_batch_archive` | `conversationIds[]` | Archive multiple conversations at once |

### Write — Exchanges (5)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_pre_approve_exchange` | `conversationId` | Pre-approve an exchange request |
| `he_cancel_exchange` | `conversationId`, `reason` | Cancel an exchange with reason |
| `he_change_exchange_type` | `conversationId`, `senderHomeId?` | Switch exchange to reciprocal (auto-detects attached home) |
| `he_change_exchange_home` | `exchangeId`, `homeId` | Change which home is proposed in an exchange |
| `he_rate_home` | `conversationId`, `clean`, `expectation`, `communication`, `feedback?` | Rate a property after an exchange (scores 1–5) |

### Write — Saved Searches (2)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_create_saved_search` | `searchData` | Save a search from filters |
| `he_delete_saved_search` | `searchId` | Delete a saved search |

### Write — Exchange Dates (1)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_update_exchange_dates` | `conversationId`, `dates` | Update exchange dates for a conversation |

### 🔐 Auth Utilities (4)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_auth_status` | — | Check auth status + verify token against live API |
| `he_set_tokens` | `accessToken`, `refreshToken?` | Inject tokens at runtime (no restart needed) |
| `he_set_cookies` | `cookies` | Inject full cookie string (include `PHPSESSID` for auto-renewal) |
| `he_refresh_token` | — | Force token renewal via stored `PHPSESSID` session cookie |

## Search filter format

```json
{
  "location": {
    "bounds": {
      "sw": { "lat": 39.0, "lon": 1.2 },
      "ne": { "lat": 40.2, "lon": 4.5 }
    }
  },
  "guests_nb": 4,
  "home": {
    "size": { "bedrooms": 2 },
    "amenities": ["swimming-pool"],
    "type": "home"
  },
  "calendar": {
    "date_ranges": [{ "from": "2026-08-05", "to": "2026-08-19" }]
  },
  "exchange_type": "reciprocal",
  "filters": ["home-verified", "response-rate-above-threshold"]
}
```

## Architecture

```
src/
├── index.ts    — Entry point, StdioServerTransport, env validation
├── server.ts   — 52 MCP tool definitions + request dispatch
├── api.ts      — HTTP client (BFF + Main API, rate limiting, retries)
├── auth.ts     — Token management, browser cookie parsing, disk cache
└── types.ts    — TypeScript interfaces
```

**API endpoints used:**
- BFF: `https://bff.homeexchange.com` — search, favorites, exchange management
- API: `https://api.homeexchange.com` — properties, users, calendar, conversations
