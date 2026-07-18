# HomeExchange MCP — Référence des outils

Paramètres complets des 52 outils, configuration, format des filtres de recherche et architecture.
Retour au [README](../README.fr.md).

## Configuration

### `.mcp.json` (au niveau du projet)

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

\* Au moins une méthode d'auth requise (`HE_ACCESS_TOKEN`, `HE_COOKIES` ou `he_set_tokens` au runtime).

### Priorité d'authentification

| Priorité | Méthode | Description |
|----------|---------|-------------|
| 1 | Variable `HE_ACCESS_TOKEN` | Recommandé — coller le token depuis le navigateur |
| 2 | Variable `HE_COOKIES` | Chaîne complète des cookies DevTools — active le renouvellement auto si `PHPSESSID` inclus |
| 3 | Cache disque | `~/.homeexchange-mcp-tokens.json` (utilisé automatiquement, renouvelé si PHPSESSID stocké) |
| 4 | Runtime | Appeler l'outil `he_set_tokens` ou `he_set_cookies` |

## Outils (52)

### 🏠 Propriétés (6 lecture)

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

### ❤️ Favoris (5 lecture)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_get_favorites` | — | Liste des IDs de propriétés en favori |
| `he_get_favorites_full` | `page?`, `limit?` | Favoris avec détails complets des propriétés (paginé) |
| `he_get_wishlists` | `page?`, `limit?` | Dossiers de favoris |
| `he_get_who_favorited_me` | `homeId`, `page?`, `limit?` | Utilisateurs ayant mis votre propriété en favori |
| `he_create_wishlist` | `name` | Créer un nouveau dossier de favoris |

### 💬 Conversations & Messages (8 lecture)

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

### 🔄 Échanges (2 lecture)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `he_get_my_exchanges` | `filter?`, `limit?`, `offset?` | Mes échanges (`upcoming` / `ongoing` / `past`) |
| `he_get_cancellation_reasons` | — | Raisons valides pour annuler un échange |

### 🔍 Recherche & Abonnement (5 lecture)

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

## Format des filtres de recherche

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
├── index.ts    — Point d'entrée, StdioServerTransport, validation des env vars
├── server.ts   — Définition des 52 outils MCP + dispatch des requêtes
├── api.ts      — Client HTTP (BFF + API principale, rate limiting, retries)
├── auth.ts     — Gestion des tokens, parsing des cookies navigateur, cache disque
└── types.ts    — Interfaces TypeScript
```

**Endpoints API utilisés :**
- BFF : `https://bff.homeexchange.com` — recherche, favoris, gestion des échanges
- API : `https://api.homeexchange.com` — propriétés, utilisateurs, calendrier, conversations
