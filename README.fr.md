<div align="center">

# HomeExchange MCP

**Serveur MCP pour [HomeExchange](https://www.homeexchange.com) — parcourir les annonces, gérer votre calendrier, envoyer des messages et suivre vos échanges depuis votre assistant IA, en langage naturel.**

[![License: MIT](https://img.shields.io/github/license/manganate006/homeexchange-mcp)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.26%2B-purple)

**[Installation](#installation) · [Outils](#outils) · [Exemples](#exemples) · [Limites](#limites) · [🇬🇧 English](README.md)**

</div>

## Aperçu

Ce serveur [MCP](https://modelcontextprotocol.io) expose la plateforme HomeExchange sous forme de **52 outils** que votre assistant peut appeler. Vous demandez en langage naturel, il exécute :

> **Vous :** Trouve des maisons à Majorque disponibles du 5 au 19 août avec piscine et au moins 2 chambres, puis montre mes conversations non lues.
>
> **Assistant :** *(appelle `he_search_homes`, puis `he_get_conversations`)*
> 7 maisons correspondent à Majorque — meilleur choix : une villa vérifiée de 3 chambres avec piscine, 92 % de taux de réponse.
> Vous avez 2 conversations non lues : Marta (Palma) et Lluís (Sóller).

## Prérequis

- **Node.js ≥ 18**
- Un compte **HomeExchange** avec un abonnement actif
- Un **client compatible MCP** — Claude Code, Claude Desktop, Cursor, Windsurf…

## Installation

Non publié sur npm — lancez depuis le bundle local :

```bash
git clone https://github.com/manganate006/homeexchange-mcp
cd homeexchange-mcp
npm install && npm run bundle   # → dist/bundle.js
```

### Claude Code

```bash
claude mcp add homeexchange \
  --env HE_ACCESS_TOKEN=votre_token \
  -- node /chemin/absolu/vers/homeexchange-mcp/dist/bundle.js
```

### Claude Desktop / Cursor

Ajoutez à `claude_desktop_config.json` (ou à la config MCP de votre client) :

```json
{
  "mcpServers": {
    "homeexchange": {
      "command": "node",
      "args": ["/chemin/absolu/vers/homeexchange-mcp/dist/bundle.js"],
      "env": { "HE_ACCESS_TOKEN": "eyJ..." }
    }
  }
}
```

## Authentification

> ⚠️ **Pas de connexion automatique.** HomeExchange utilise Auth0 avec CAPTCHA AWS WAF + Cloudflare Turnstile, qui bloquent les sessions automatisées. Vous collez un token depuis votre navigateur une fois.

1. Connectez-vous à [homeexchange.com](https://www.homeexchange.com)
2. DevTools → **Application → Cookies → `homeexchange.com`**
3. Copiez la valeur de **`oidc_access_token`** → renseignez-la dans `HE_ACCESS_TOKEN`

Le token est valable **~24 h** et mis en cache dans `~/.homeexchange-mcp-tokens.json`. Fournissez la chaîne complète des cookies via `HE_COOKIES` (avec `PHPSESSID`) pour activer le **renouvellement automatique** — plus aucune action manuelle ensuite.

| Variable | Requis | Rôle |
|---|---|---|
| `HE_ACCESS_TOKEN` | une méthode* | JWT du cookie `oidc_access_token` |
| `HE_COOKIES` | une méthode* | Chaîne complète des cookies ; active le renouvellement auto si `PHPSESSID` est inclus |

\* Au moins l'une de `HE_ACCESS_TOKEN` / `HE_COOKIES`, ou injection au runtime avec `he_set_tokens`. Réglage du rate limiting (`HE_READ_DELAY`, `HE_WRITE_DELAY`, `HE_MESSAGE_DELAY`, `HE_WEB_VERSION`) et priorité d'auth complète : voir **[docs/TOOLS.fr.md](docs/TOOLS.fr.md#configuration)**.

## Outils

52 outils, préfixe `he_`. Résumé par domaine — paramètres complets dans **[docs/TOOLS.fr.md](docs/TOOLS.fr.md)**.

| Domaine | Outils | Exemples |
|---|---|---|
| 🏠 Propriétés | 9 | `he_get_home`, `he_get_calendar`, `he_update_calendar` |
| 👤 Utilisateurs | 3 | `he_get_user`, `he_get_user_ratings` |
| ❤️ Favoris | 7 | `he_get_favorites`, `he_add_favorite`, `he_create_wishlist` |
| 💬 Conversations & messages | 14 | `he_get_conversations`, `he_send_message`, `he_send_first_message` |
| 🔄 Échanges | 8 | `he_get_my_exchanges`, `he_change_exchange_type`, `he_rate_home` |
| 🔍 Recherche & abonnement | 7 | `he_search_homes`, `he_get_saved_searches` |
| 🔐 Utilitaires auth | 4 | `he_auth_status`, `he_set_tokens` |

## Exemples

- « Cherche des maisons à Majorque disponibles du 5 au 19 août avec piscine et au moins 2 chambres »
- « Montre mes conversations non lues »
- « Traduis le dernier message de la conversation 12345 en anglais »
- « Marque mon calendrier comme indisponible du 15 juillet au 20 août »
- « Contacte le propriétaire du logement 98765 pour le 1er–8 septembre, 4 personnes »
- « Passe l'échange de la conversation 11111 en réciproque »

## Limites

- **Token manuel** toutes les ~24 h, sauf renouvellement auto configuré via `PHPSESSID`
- **Pas d'upload d'images** pour les photos de propriété/profil (multipart pas encore implémenté)
- **Pas de création de propriété** — l'endpoint `POST /v1/homes` n'est pas exposé
- La pagination des conversations est gérée côté client (l'API v3 ignore le curseur `after`)

## Développement

```bash
npm run dev      # tsc watch
npm run build    # compilation TypeScript
npm run bundle   # fichier unique dist/bundle.js (démarrage rapide)
npx @modelcontextprotocol/inspector node dist/bundle.js
```

Référence complète des outils, format des filtres de recherche et architecture : **[docs/TOOLS.fr.md](docs/TOOLS.fr.md)**.

## Licence

[MIT](LICENSE)
