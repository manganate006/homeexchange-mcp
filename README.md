<a name="english"></a>

---

[🇬🇧 English](#english) &nbsp;|&nbsp; [🇫🇷 Français](#français)

---

# HomeExchange MCP Server

![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.26%2B-purple)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

A **Model Context Protocol (MCP)** server for interacting with the [HomeExchange](https://www.homeexchange.com) platform directly from your AI assistant.

Browse properties, manage conversations, update your calendar, handle favorites and exchanges — all with natural language.

---

## ✨ Features

- **52 MCP tools** covering read and write operations
- 🔍 **Property search** with advanced filters: bounding box, dates, bedrooms, amenities, pool...
- 💬 **Messaging**: read conversations, send messages, first contact with owners
- 📅 **Calendar management**: mark periods as available / unavailable / maybe
- ❤️ **Favorites & wishlists**: add, remove, browse, create folders
- 🔄 **Exchange tracking**: upcoming, ongoing, past — switch type, change home, update dates
- 🔑 **Auth via JWT token** extracted from the browser — no password stored
- 💾 Persistent token cache (`~/.homeexchange-mcp-tokens.json`, ~24h TTL)
- ♻️ Auto-retry on rate limit (429) with exponential backoff
- 🚦 **Smart rate limiting**: separate delays for reads (500ms), writes (2s) and messages (60s)
- ✅ **Auth verification**: `he_auth_status` checks tokens against the live API
- 🛡️ **Pre-flight checks**: `he_send_first_message` validates calendar availability before sending

---

## 📋 Prerequisites

- **Node.js** ≥ 18
- A **HomeExchange** account (active subscription)
- A **MCP-compatible client**: any host supporting the Model Context Protocol (Cursor, Windsurf, VS Code MCP extension, etc.)

---

## 🚀 Quick Start

```bash
# 1. Clone and build
git clone https://github.com/manganate006/homeexchange-mcp
cd homeexchange-mcp
npm install && npm run bundle

# 2. Get your token (see Authentication section below)

# 3. Add to your MCP client config (see Configuration section below)
```

---

## 🔑 Authentication

> ⚠️ **Automated login is not possible.** HomeExchange uses Auth0 with AWS WAF visual CAPTCHA and Cloudflare Turnstile, which block automated browser sessions.

You must manually extract your access token from the browser after logging in.

### How to get your token

1. Open [homeexchange.com](https://www.homeexchange.com) and log in
2. Open browser **DevTools** → **Application** → **Cookies** → `homeexchange.com`
3. Copy the value of **`oidc_access_token`** (or `access_token`)
4. Set it as `HE_ACCESS_TOKEN` in your config (see below)

The token is valid for **~24 hours**. It is cached at `~/.homeexchange-mcp-tokens.json` and reused automatically until it expires.

> 💡 **Auto-renewal:** If you provide `HE_COOKIES` with the full cookie string including `PHPSESSID`, the server can renew your token automatically when it expires — no manual action needed. The `PHPSESSID` lets the BFF retrieve the server-side refresh token.

### Authentication priority

| Priority | Method | Description |
|----------|--------|-------------|
| 1 | `HE_ACCESS_TOKEN` env var | Recommended — paste token from browser |
| 2 | `HE_COOKIES` env var | Full cookie string from DevTools — enables auto-renewal if `PHPSESSID` is included |
| 3 | Disk cache | `~/.homeexchange-mcp-tokens.json` (auto-used if valid, auto-refreshed if PHPSESSID stored) |
| 4 | Runtime | Call `he_set_tokens` or `he_set_cookies` tool |

---

## ⚙️ Configuration

### `.mcp.json` (project-level config)

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

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HE_ACCESS_TOKEN` | No* | — | JWT bearer token (`oidc_access_token` cookie) |
| `HE_REFRESH_TOKEN` | No | — | Refresh token for session renewal |
| `HE_COOKIES` | No* | — | Raw `document.cookie` string from browser |
| `HE_READ_DELAY` | No | `500` | Delay between read (GET) requests (ms) |
| `HE_WRITE_DELAY` | No | `2000` | Delay between write requests (ms) |
| `HE_MESSAGE_DELAY` | No | `60000` | Minimum delay between message sends (ms) |
| `HE_REQUEST_DELAY` | No | — | Legacy: sets both read and write delay if the new vars aren't set |
| `HE_WEB_VERSION` | No | `19.7.2` | HomeExchange web version header |

\* At least one auth method required (`HE_ACCESS_TOKEN`, `HE_COOKIES`, or runtime `he_set_tokens`)

---

## 🛠️ Tools (52)

### 🏠 Properties (6)

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

### ❤️ Favorites (5)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_get_favorites` | — | List of favorited property IDs |
| `he_get_favorites_full` | `page?`, `limit?` | Favorites with full property details (paginated) |
| `he_get_wishlists` | `page?`, `limit?` | Favorite folders / collections |
| `he_get_who_favorited_me` | `homeId`, `page?`, `limit?` | Users who favorited one of your properties |
| `he_create_wishlist` | `name` | Create a new favorites folder |

### 💬 Conversations & Messages (8)

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

### 🔄 Exchanges (2)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `he_get_my_exchanges` | `filter?`, `limit?`, `offset?` | My exchanges (`upcoming` / `ongoing` / `past`) |
| `he_get_cancellation_reasons` | — | Valid reasons for cancelling an exchange |

### 🔍 Search & Subscription (5)

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

---

## 💡 Usage Examples

```
Search for houses in Mallorca available August 5–19 with pool and at least 2 bedrooms

Show my unread conversations

Translate the last message from conversation 12345 to French

Mark my home's calendar as unavailable from July 15 to August 20

Send a message to conversation 67890: "Hello, we're very interested in your property..."

Check my authentication status

Switch exchange in conversation 11111 to reciprocal
```

---

## 🔍 Search Filter Format

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

---

## 🏗️ Architecture

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

---

## ⚠️ Limitations

- **No auto-login**: token must be manually extracted from the browser every ~24h (unless `PHPSESSID` enables auto-renewal)
- **No image upload**: multipart upload for property/profile photos not yet implemented
- **No property creation**: `POST /v1/homes` not yet exposed
- **Conversation pagination**: the v3 API ignores cursor-based `after` — pagination is handled client-side

---

## 🤝 Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

```bash
npm run dev      # Watch mode for development
npm run build    # Compile TypeScript
npm run bundle   # Bundle for production (single file, fast startup)
```

---

## 📄 License

MIT

---
---

<a name="français"></a>

[🇬🇧 English](#english) &nbsp;|&nbsp; [🇫🇷 Français](#français)

---

# HomeExchange MCP Server

![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.26%2B-purple)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

Un serveur **Model Context Protocol (MCP)** pour interagir avec la plateforme [HomeExchange](https://www.homeexchange.com) directement depuis votre assistant IA.

Parcourez des propriétés, gérez vos conversations, mettez à jour votre calendrier, gérez vos favoris et vos échanges — le tout en langage naturel.

---

## ✨ Fonctionnalités

- **52 outils MCP** couvrant les opérations de lecture et d'écriture
- 🔍 **Recherche de propriétés** avec filtres avancés : zone géographique, dates, chambres, équipements, piscine...
- 💬 **Messagerie** : lire les conversations, envoyer des messages, premier contact avec des propriétaires
- 📅 **Gestion du calendrier** : marquer des périodes comme disponible / indisponible / peut-être
- ❤️ **Favoris & dossiers** : ajouter, retirer, parcourir, créer des dossiers
- 🔄 **Suivi des échanges** : à venir, en cours, passés — changer de type, changer de logement, modifier les dates
- 🔑 **Auth par token JWT** extrait du navigateur — aucun mot de passe stocké
- 💾 Cache de token persistant (`~/.homeexchange-mcp-tokens.json`, durée de vie ~24h)
- ♻️ Retry automatique sur les erreurs 429 avec backoff exponentiel
- 🚦 **Rate limiting intelligent** : délais séparés pour lectures (500ms), écritures (2s) et messages (60s)
- ✅ **Vérification auth** : `he_auth_status` vérifie les tokens contre l'API en live
- 🛡️ **Vérifications pré-envoi** : `he_send_first_message` valide la disponibilité du calendrier avant l'envoi

---

## 📋 Prérequis

- **Node.js** ≥ 18
- Un compte **HomeExchange** (avec abonnement actif)
- Un **client compatible MCP** : tout hôte supportant le Model Context Protocol (Cursor, Windsurf, extension MCP VS Code, etc.)

---

## 🚀 Démarrage rapide

```bash
# 1. Cloner et compiler
git clone https://github.com/manganate006/homeexchange-mcp
cd homeexchange-mcp
npm install && npm run bundle

# 2. Récupérer votre token (voir section Authentification ci-dessous)

# 3. Ajouter à la config de votre client MCP (voir section Configuration ci-dessous)
```

---

## 🔑 Authentification

> ⚠️ **La connexion automatique n'est pas possible.** HomeExchange utilise Auth0 avec un CAPTCHA visuel AWS WAF et Cloudflare Turnstile, qui bloquent les sessions automatisées.

Vous devez extraire manuellement votre token d'accès depuis le navigateur après vous être connecté.

### Comment obtenir votre token

1. Ouvrez [homeexchange.com](https://www.homeexchange.com) et connectez-vous
2. Ouvrez les **DevTools** du navigateur → **Application** → **Cookies** → `homeexchange.com`
3. Copiez la valeur de **`oidc_access_token`** (ou `access_token`)
4. Renseignez-la dans `HE_ACCESS_TOKEN` dans votre config (voir ci-dessous)

Le token est valable **~24 heures**. Il est mis en cache dans `~/.homeexchange-mcp-tokens.json` et réutilisé automatiquement jusqu'à expiration.

> 💡 **Renouvellement automatique :** Si vous fournissez `HE_COOKIES` avec la chaîne complète incluant `PHPSESSID`, le serveur peut renouveler votre token automatiquement à l'expiration — sans action manuelle. Le `PHPSESSID` permet au BFF de récupérer le refresh token côté serveur.

### Priorité d'authentification

| Priorité | Méthode | Description |
|----------|---------|-------------|
| 1 | Variable `HE_ACCESS_TOKEN` | Recommandé — coller le token depuis le navigateur |
| 2 | Variable `HE_COOKIES` | Chaîne complète des cookies DevTools — active le renouvellement auto si `PHPSESSID` inclus |
| 3 | Cache disque | `~/.homeexchange-mcp-tokens.json` (utilisé automatiquement, renouvelé si PHPSESSID stocké) |
| 4 | Runtime | Appeler l'outil `he_set_tokens` ou `he_set_cookies` |

---

## ⚙️ Configuration

### `.mcp.json` (config au niveau du projet)

```json
{
  "mcpServers": {
    "homeexchange": {
      "type": "stdio",
      "command": "node",
      "args": ["/chemin/absolu/vers/homeexchange-mcp/dist/bundle.js"],
      "timeout": 60000,
      "env": {
        "HE_ACCESS_TOKEN": "eyJ..."
      }
    }
  }
}
```

### Variables d'environnement

| Variable | Requis | Défaut | Description |
|----------|--------|--------|-------------|
| `HE_ACCESS_TOKEN` | Non* | — | Token JWT Bearer (cookie `oidc_access_token`) |
| `HE_REFRESH_TOKEN` | Non | — | Token de refresh pour renouveler la session |
| `HE_COOKIES` | Non* | — | Chaîne `document.cookie` brute du navigateur |
| `HE_READ_DELAY` | Non | `500` | Délai entre les requêtes de lecture GET (ms) |
| `HE_WRITE_DELAY` | Non | `2000` | Délai entre les requêtes d'écriture (ms) |
| `HE_MESSAGE_DELAY` | Non | `60000` | Délai minimum entre les envois de messages (ms) |
| `HE_REQUEST_DELAY` | Non | — | Legacy : définit les délais read et write si les nouvelles variables ne sont pas définies |
| `HE_WEB_VERSION` | Non | `19.7.2` | Header de version web HomeExchange |

\* Au moins une méthode d'auth requise (`HE_ACCESS_TOKEN`, `HE_COOKIES` ou `he_set_tokens` au runtime)

---

## 🛠️ Outils (52)

### 🏠 Propriétés (6)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_get_home` | `homeId`, `locale?` | Détails complets : localisation, équipements, photos, propriétaire, descriptions. `locale` ne garde qu'une langue de description (marquée `is_fallback` si absente) |
| `he_get_home_descriptions` | `homeId`, `locales?` | Textes de description par langue, format compact (défaut `["fr", "en"]`) ; signale `is_fallback` quand une langue n'a pas de traduction |
| `he_get_calendar` | `homeId` | Calendrier de disponibilité (disponible / indisponible / peut-être) |
| `he_get_calendar_batch` | `homeIds[]` | Calendriers de plusieurs propriétés en un seul appel (max 20) |
| `he_get_ratings` | `homeId` | Avis : propreté, conformité aux attentes, communication, retours texte |
| `he_get_my_homes` | — | Toutes les propriétés de l'utilisateur connecté |

### 👤 Utilisateurs (3)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_get_user` | `userId` | Profil : nom, statut vérifié, nombre d'échanges, taux de réponse |
| `he_get_user_achievements` | `userId` | Niveau de fidélité GuestPoints et badges |
| `he_get_user_ratings` | `userId`, `limit?` | Avis sur un utilisateur (en tant qu'hôte et invité) |

### ❤️ Favoris (5)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_get_favorites` | — | Liste des IDs de propriétés en favori |
| `he_get_favorites_full` | `page?`, `limit?` | Favoris avec détails complets des propriétés (paginé) |
| `he_get_wishlists` | `page?`, `limit?` | Dossiers de favoris |
| `he_get_who_favorited_me` | `homeId`, `page?`, `limit?` | Utilisateurs ayant mis votre propriété en favori |
| `he_create_wishlist` | `name` | Créer un nouveau dossier de favoris |

### 💬 Conversations & Messages (8)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_get_conversations` | `filter?`, `first?`, `after?` | Liste des conversations avec pagination et filtres (`ALL`, `UNREAD`, `ARCHIVED`…) |
| `he_get_conversation` | `conversationId` | Détails d'une conversation (participants, échanges) |
| `he_get_conversation_stats` | — | Statistiques : non lus, total |
| `he_get_messages` | `conversationId`, `limit?`, `offset?` | Messages d'une conversation (paginé) |
| `he_translate_message` | `messageId`, `targetLanguage` | Traduire un message (ex. `fr`, `en`, `es`) |
| `he_translate_messages_batch` | `messageIds[]`, `targetLanguage` | Traduire plusieurs messages en une fois |
| `he_search_conversations` | `query` | Rechercher dans les conversations par mot-clé |
| `he_get_messages_config` | — | Configuration de la messagerie et templates |

### 🔄 Échanges (2)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_get_my_exchanges` | `filter?`, `limit?`, `offset?` | Mes échanges (`upcoming` / `ongoing` / `past`) |
| `he_get_cancellation_reasons` | — | Raisons valides pour annuler un échange |

### 🔍 Recherche & Abonnement (5)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_search_homes` | `filters`, `offset?`, `limit?`, `min_response_rate?` | Recherche de propriétés (zone, dates, chambres, équipements…) |
| `he_get_saved_searches` | — | Toutes les recherches sauvegardées |
| `he_get_saved_search` | `searchId` | Détails d'une recherche sauvegardée |
| `he_get_last_searches` | — | Historique des dernières recherches |
| `he_get_subscription` | — | Informations sur l'abonnement (type, expiration, renouvellement automatique) |

### ✉️ Écriture — Messages (2)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_send_message` | `conversationId`, `content` | Envoyer un message dans une conversation existante |
| `he_send_first_message` | `receiverId`, `homeId`, `content`, `startOn`, `endOn`, `nbGuest`, `exchangeType?`, `senderHomeId?` | Premier contact avec un propriétaire (crée une conversation). Vérifie la disponibilité du calendrier. |

### 📅 Écriture — Propriétés (3)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_update_calendar` | `homeId`, `periods[]` | Modifier les disponibilités : `status` 1=disponible, 2=indisponible, 3=peut-être |
| `he_update_home` | `homeId`, `fields` | Modifier les détails de la propriété (capacité, nuits minimum, équipements…) |
| `he_update_description` | `homeId`, `title?`, `good_feature?`, `good_place?`, `other?`, `locale?` | Modifier les textes de description. Les champs omis sont préservés (fusionnés depuis les valeurs actuelles de la locale cible) ; `locale` crée/met à jour une version linguistique |

### Écriture — Favoris (2)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_add_favorite` | `homeId`, `wishlistId?` | Ajouter aux favoris (optionnellement dans un dossier) |
| `he_remove_favorite` | `homeId` | Retirer des favoris |

### Écriture — Conversations (4)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_archive_conversation` | `conversationId` | Archiver une conversation |
| `he_unarchive_conversation` | `conversationId` | Désarchiver une conversation |
| `he_favorite_conversation` | `conversationId`, `favorite?` | Ajouter / retirer une conversation des favoris (étoile) |
| `he_batch_archive` | `conversationIds[]` | Archiver plusieurs conversations en une fois |

### Écriture — Échanges (5)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_pre_approve_exchange` | `conversationId` | Pré-approuver une demande d'échange |
| `he_cancel_exchange` | `conversationId`, `reason` | Annuler un échange avec une raison |
| `he_change_exchange_type` | `conversationId`, `senderHomeId?` | Passer l'échange en réciproque (détecte automatiquement le logement attaché) |
| `he_change_exchange_home` | `exchangeId`, `homeId` | Changer le logement proposé dans un échange |
| `he_rate_home` | `conversationId`, `clean`, `expectation`, `communication`, `feedback?` | Noter une propriété après un échange (scores 1–5) |

### Écriture — Recherches sauvegardées (2)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_create_saved_search` | `searchData` | Sauvegarder une recherche depuis des filtres |
| `he_delete_saved_search` | `searchId` | Supprimer une recherche sauvegardée |

### Écriture — Dates d'échange (1)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_update_exchange_dates` | `conversationId`, `dates` | Modifier les dates d'un échange |

### 🔐 Utilitaires Auth (4)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_auth_status` | — | Vérifier le statut + validation du token contre l'API en live |
| `he_set_tokens` | `accessToken`, `refreshToken?` | Injecter des tokens au runtime (sans redémarrage) |
| `he_set_cookies` | `cookies` | Injecter la chaîne complète de cookies (inclure `PHPSESSID` pour le renouvellement auto) |
| `he_refresh_token` | — | Forcer le renouvellement du token via le cookie de session `PHPSESSID` stocké |

---

## 💡 Exemples d'utilisation

```
Cherche des maisons à Majorque disponibles du 5 au 19 août avec piscine et au moins 2 chambres

Montre mes conversations non lues

Traduis le dernier message de la conversation 12345 en anglais

Marque mon calendrier comme indisponible du 15 juillet au 20 août

Envoie un message à la conversation 67890 : "Bonjour, votre propriété nous intéresse beaucoup..."

Vérifie mon statut d'authentification

Passe l'échange de la conversation 11111 en réciproque
```

---

## 🔍 Format des filtres de recherche

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

---

## 🏗️ Architecture

```
src/
├── index.ts    — Point d'entrée, StdioServerTransport, validation des env vars
├── server.ts   — Définition des 52 outils MCP + dispatch des requêtes
├── api.ts      — Client HTTP (BFF + API principale, rate limiting, retries)
├── auth.ts     — Gestion des tokens, parsing des cookies navigateur, cache disque
└── types.ts    — Interfaces TypeScript
```

**Endpoints API utilisés :**
- BFF : `https://bff.homeexchange.com` — recherche, favoris, gestion des échanges
- API : `https://api.homeexchange.com` — propriétés, utilisateurs, calendrier, conversations

---

## ⚠️ Limitations

- **Pas de connexion automatique** : le token doit être extrait manuellement du navigateur toutes les ~24h (sauf si `PHPSESSID` active le renouvellement auto)
- **Pas d'upload d'images** : l'upload multipart pour les photos n'est pas encore implémenté
- **Pas de création de propriété** : l'endpoint `POST /v1/homes` n'est pas encore exposé
- **Pagination conversations** : l'API v3 ignore le curseur `after` — la pagination est gérée côté client

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou à soumettre une pull request.

```bash
npm run dev      # Mode watch pour le développement
npm run build    # Compiler TypeScript
npm run bundle   # Bundler pour la production (fichier unique, démarrage rapide)
```

---

## 📄 Licence

MIT
