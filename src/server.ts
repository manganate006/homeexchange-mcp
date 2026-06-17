import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { HomeExchangeAuth } from "./auth.js";
import { HomeExchangeApi } from "./api.js";

// ─── Zod schemas ────────────────────────────────────────────────────────────────────

const HomeIdSchema = z.object({ homeId: z.coerce.number().int().positive() });
const ConversationIdSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
});
const ConversationsSchema = z.object({
  filter: z.enum(["ALL", "UNREAD"]).default("ALL"),
  first: z.coerce.number().int().min(1).max(50).default(10),
  after: z.coerce.number().int().min(0).default(0),
});
const SendMessageSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
  content: z.string().min(1),
});
const SendFirstMessageSchema = z.object({
  receiverId: z.coerce.number().int().positive(),
  homeId: z.coerce.number().int().positive(),
  content: z.string().min(1),
  startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nbGuest: z.coerce.number().int().min(1),
  exchangeType: z.coerce.number().int().min(1).max(2).optional(),
});
const UpdateCalendarSchema = z.object({
  homeId: z.coerce.number().int().positive(),
  periods: z.array(
    z.object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      status: z.coerce.number().int().min(1).max(3),
    })
  ),
});
const UpdateHomeSchema = z.object({
  homeId: z.coerce.number().int().positive(),
  fields: z.record(z.unknown()),
});
const UpdateDescriptionSchema = z.object({
  homeId: z.coerce.number().int().positive(),
  title: z.string().optional(),
  good_feature: z.string().optional(),
  good_place: z.string().optional(),
  other: z.string().optional(),
  locale: z.string().default("fr"),
});

const UserIdSchema = z.object({ userId: z.coerce.number().int().positive() });
const UserRatingsSchema = z.object({
  userId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ExchangesSchema = z.object({
  filter: z.enum(["upcoming", "ongoing", "past"]).default("upcoming"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const TranslateMessageSchema = z.object({
  messageId: z.coerce.number().int().positive(),
  targetLanguage: z.string().min(2).max(5),
});
const SearchHomesSchema = z.object({
  filters: z.record(z.unknown()),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  min_response_rate: z.coerce.number().int().min(0).max(100).optional(),
});
const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const SearchConversationsSchema = z.object({
  query: z.string().min(1),
});
const AddFavoriteSchema = z.object({
  homeId: z.coerce.number().int().positive(),
  wishlistId: z.coerce.number().int().positive().optional(),
});
const CancelExchangeSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
  reason: z.string().min(1),
});
const RateHomeSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
  clean: z.coerce.number().int().min(1).max(5),
  expectation: z.coerce.number().int().min(1).max(5),
  communication: z.coerce.number().int().min(1).max(5),
  feedback: z.string().optional(),
});
const WhoFavoritedMeSchema = z.object({
  homeId: z.coerce.number().int().positive(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const SavedSearchIdSchema = z.object({
  searchId: z.string().min(1),
});
const CreateSavedSearchSchema = z.object({
  searchData: z.record(z.unknown()),
});
const CalendarBatchSchema = z.object({
  homeIds: z.array(z.coerce.number().int().positive()).min(1).max(20),
});
const BatchArchiveSchema = z.object({
  conversationIds: z.array(z.coerce.number().int().positive()).min(1),
});
const TranslateMessagesBatchSchema = z.object({
  messageIds: z.array(z.coerce.number().int().positive()).min(1),
  targetLanguage: z.string().min(2).max(5),
});
const UpdateExchangeDatesSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
  dates: z.record(z.unknown()),
});
const SetTokensSchema = z.object({
  accessToken: z.string().min(10),
  refreshToken: z.string().optional(),
});
const SetCookiesSchema = z.object({
  cookies: z.string().min(10),
});
const MessagesSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ─── Tool definitions ──────────────────────────────────────────────────────────────────

const TOOLS = [
  { name: "he_get_home", description: "Get full details of a HomeExchange property (name, location, GPS, features, photos, owner info, descriptions, amenities)", inputSchema: { type: "object" as const, properties: { homeId: { type: "number", description: "HomeExchange property ID" } }, required: ["homeId"] } },
  { name: "he_get_calendar", description: "Get availability calendar for a single property. ⚠️ For multiple homes, use he_get_calendar_batch instead to avoid repeated calls.", inputSchema: { type: "object" as const, properties: { homeId: { type: "number", description: "HomeExchange property ID" } }, required: ["homeId"] } },
  { name: "he_get_calendar_batch", description: "Get availability calendars for multiple properties in one call. Prefer this over calling he_get_calendar repeatedly. Max 20 homes.", inputSchema: { type: "object" as const, properties: { homeIds: { type: "array", items: { type: "number" }, description: "List of property IDs (max 20)" } }, required: ["homeIds"] } },
  { name: "he_get_ratings", description: "Get reviews and ratings for a HomeExchange property (cleanliness, expectations, communication scores, feedback text)", inputSchema: { type: "object" as const, properties: { homeId: { type: "number", description: "HomeExchange property ID" } }, required: ["homeId"] } },
  { name: "he_get_favorites", description: "Get the list of property IDs saved as favorites by the authenticated user", inputSchema: { type: "object" as const, properties: {} } },
  {
    name: "he_get_conversations",
    description: "Get the user's conversations list with pagination. Returns conversation metadata, last message preview, exchange details",
    inputSchema: { type: "object" as const, properties: {
      filter: { type: "string", enum: ["ALL", "UNREAD"], description: "Filter conversations (default: ALL)" },
      first: { type: "number", description: "Number of conversations to return (1-50, default: 10)" },
      after: { type: "number", description: "Pagination cursor offset (default: 0)" },
    } },
  },
  {
    name: "he_get_messages",
    description: "Get messages from a specific conversation. Supports pagination via limit/offset.",
    inputSchema: { type: "object" as const, properties: {
      conversationId: { type: "number", description: "Conversation ID" },
      limit: { type: "number", description: "Max number of messages to return (default: all)" },
      offset: { type: "number", description: "Number of messages to skip (default: 0)" },
    }, required: ["conversationId"] },
  },
  { name: "he_get_user", description: "Get a HomeExchange user's profile (name, verified status, number of exchanges, response rate, images)", inputSchema: { type: "object" as const, properties: { userId: { type: "number", description: "User ID" } }, required: ["userId"] } },
  { name: "he_get_user_achievements", description: "Get a user's GuestPoints loyalty level and achievements", inputSchema: { type: "object" as const, properties: { userId: { type: "number", description: "User ID" } }, required: ["userId"] } },
  { name: "he_get_user_ratings", description: "Get reviews/ratings about a user (as host and guest)", inputSchema: { type: "object" as const, properties: { userId: { type: "number", description: "User ID" }, limit: { type: "number", description: "Max ratings to return (default: 50)" } }, required: ["userId"] } },
  { name: "he_get_my_homes", description: "Get all properties owned by the authenticated user", inputSchema: { type: "object" as const, properties: {} } },
  { name: "he_get_my_exchanges", description: "Get the user's exchanges (upcoming, ongoing, or past) with pagination", inputSchema: { type: "object" as const, properties: { filter: { type: "string", enum: ["upcoming", "ongoing", "past"], description: "Filter by exchange status (default: upcoming)" }, limit: { type: "number", description: "Number of results (default: 20)" }, offset: { type: "number", description: "Pagination offset (default: 0)" } } } },
  { name: "he_get_conversation", description: "Get detailed info about a single conversation (participants, exchanges, stay requests)", inputSchema: { type: "object" as const, properties: { conversationId: { type: "number", description: "Conversation ID" } }, required: ["conversationId"] } },
  { name: "he_get_conversation_stats", description: "Get conversation statistics (unread count, total count)", inputSchema: { type: "object" as const, properties: {} } },
  { name: "he_translate_message", description: "Translate a message to a target language", inputSchema: { type: "object" as const, properties: { messageId: { type: "number", description: "Message ID" }, targetLanguage: { type: "string", description: "Target language code (e.g. 'fr', 'en', 'es')" } }, required: ["messageId", "targetLanguage"] } },
  { name: "he_search_conversations", description: "Search through conversations by keyword", inputSchema: { type: "object" as const, properties: { query: { type: "string", description: "Search query" } }, required: ["query"] } },
  {
    name: "he_search_homes",
    description: `Search for homes/properties. Returns slimmed results (id, location, bedrooms, rating, owner, cover image).

⚠️ IMPORTANT: If you pass calendar.date_ranges in filters, results are ALREADY filtered by availability — do NOT call he_get_calendar on each result, it is redundant and wastes tokens. Only call he_get_calendar when you need the full availability breakdown of a specific home.

Full example with all filter categories:
{
  "location": { "bounds": { "sw": { "lat": 36.0, "lon": -9.5 }, "ne": { "lat": 43.8, "lon": 4.3 } } },
  "guests_nb": 4,
  "home": {
    "type": "home",
    "size": { "bedrooms": 2, "bathrooms": 1 },
    "amenities": ["swimming-pool", "a-c", "wifi"],
    "surrounding": ["seaside"],
    "is_primary": true,
    "is_private_room": false,
    "exclude_animals": ["cat", "dog"]
  },
  "calendar": { "date_ranges": [{ "from": "2026-08-05", "to": "2026-08-19" }] },
  "exchange_type": "reciprocal",
  "filters": ["home-verified", "response-rate-above-threshold"]
}

## Filter reference

**location**: bounds {sw/ne with lat/lon} or location_id (Jawg polygon)

**home.type**: "home" (maison) | "flat" (appartement)

**home.is_private_room**: false (logement entier) | true (chambre privée)

**home.is_primary**: true (résidence principale) | false (résidence secondaire)

**home.surrounding** (array): "countryside" | "mountains" | "seaside" | "lakes" | "cities" | "villages" | "isolated" | "island"

**home.amenities** (array):
- Essentials: "heating-system" | "dishwasher" | "washing-machine" | "dryer" | "bathtub" | "tv" | "wifi" | "electric-car-plug"
- Comfort: "a-c" | "elevator" | "parking-space" | "jacuzzi" | "fireplace" | "gym" | "garden" | "balcony-terrace" | "swimming-pool" | "public-transit-access"
- Kids: "baby-bed" | "kids-toys" | "playground" | "baby-gear" | "secured-pool"
- Work: "dedicated-workspace" | "high-speed-connexion"
- Accessibility: "disabled-access" | "children-welcome" | "pets-welcome" | "smokers-welcome"

**home.exclude_animals** (array): "cat" | "dog" | "other"

**home.eco_level**: 4 (maisons durables uniquement)

**exchange_type**: "available" (all) | "reciprocal" | "guest-wanted" (GuestPoints only)

**filters** (array): "home-verified" | "response-rate-above-threshold" ← prefer this over min_response_rate param

**calendar.date_ranges**: [{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }]
**calendar.duration**: { "kind": "week-end" | "week" | "month" }

**guestpoint_range**: { "min": 0, "max": 250 } (GP per night)`,
    inputSchema: { type: "object" as const, properties: {
      filters: { type: "object", description: "Search query filters (location, calendar, home, guests_nb, filters)" },
      offset: { type: "number", description: "Pagination offset (default: 0)" },
      limit: { type: "number", description: "Number of results (default: 20, max: 50)" },
      min_response_rate: { type: "number", description: "Minimum owner response rate % to include (0-100, client-side filter)" },
    }, required: ["filters"] },
  },
  { name: "he_get_subscription", description: "Get the user's subscription plan info (type, expiry, auto-renew status)", inputSchema: { type: "object" as const, properties: {} } },
  { name: "he_get_favorites_full", description: "Get favorites with full property details (not just IDs). Paginated.", inputSchema: { type: "object" as const, properties: { page: { type: "number", description: "Page number (default: 1)" }, limit: { type: "number", description: "Results per page (default: 20)" } } } },
  { name: "he_get_wishlists", description: "Get favorite folders (wishlists) with pagination", inputSchema: { type: "object" as const, properties: { page: { type: "number", description: "Page number (default: 1)" }, limit: { type: "number", description: "Results per page (default: 20)" } } } },
  { name: "he_add_favorite", description: "Add a property to favorites. Optionally specify a wishlist folder. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { homeId: { type: "number", description: "Property ID to add" }, wishlistId: { type: "number", description: "Optional wishlist folder ID" } }, required: ["homeId"] } },
  { name: "he_remove_favorite", description: "Remove a property from favorites. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { homeId: { type: "number", description: "Property ID to remove" } }, required: ["homeId"] } },
  { name: "he_archive_conversation", description: "Archive a conversation. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { conversationId: { type: "number", description: "Conversation ID" } }, required: ["conversationId"] } },
  { name: "he_unarchive_conversation", description: "Unarchive a conversation. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { conversationId: { type: "number", description: "Conversation ID" } }, required: ["conversationId"] } },
  { name: "he_pre_approve_exchange", description: "Pre-approve an exchange request. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { conversationId: { type: "number", description: "Conversation ID" } }, required: ["conversationId"] } },
  { name: "he_cancel_exchange", description: "Cancel an exchange with a reason. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { conversationId: { type: "number", description: "Conversation ID" }, reason: { type: "string", description: "Cancellation reason" } }, required: ["conversationId", "reason"] } },
  { name: "he_rate_home", description: "Rate a home after an exchange (clean, expectation, communication: 1-5). IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { conversationId: { type: "number", description: "Conversation ID of the exchange" }, clean: { type: "number", description: "Cleanliness rating 1-5" }, expectation: { type: "number", description: "Met expectations rating 1-5" }, communication: { type: "number", description: "Communication rating 1-5" }, feedback: { type: "string", description: "Written review (optional)" } }, required: ["conversationId", "clean", "expectation", "communication"] } },
  { name: "he_send_message", description: "Send a message in an existing HomeExchange conversation. IMPORTANT: ask user confirmation before sending.", inputSchema: { type: "object" as const, properties: { conversationId: { type: "number", description: "Conversation ID" }, content: { type: "string", description: "Message text to send" } }, required: ["conversationId", "content"] } },
  { name: "he_send_first_message", description: "Send a first contact message to a property owner, creating a new conversation. exchange_type: 1=reciprocal, 2=guestpoints. IMPORTANT: ask user confirmation before sending.", inputSchema: { type: "object" as const, properties: { receiverId: { type: "number", description: "User ID of the property owner" }, homeId: { type: "number", description: "Home ID" }, content: { type: "string", description: "Message text" }, startOn: { type: "string", description: "Start date (YYYY-MM-DD)" }, endOn: { type: "string", description: "End date (YYYY-MM-DD)" }, nbGuest: { type: "number", description: "Number of guests" }, exchangeType: { type: "number", description: "1=reciprocal, 2=guestpoints (optional)" } }, required: ["receiverId", "homeId", "content", "startOn", "endOn", "nbGuest"] } },
  {
    name: "he_update_calendar",
    description: "Update availability calendar periods for a property. Status: 1=available, 2=unavailable, 3=maybe. IMPORTANT: ask user confirmation.",
    inputSchema: { type: "object" as const, properties: {
      homeId: { type: "number", description: "HomeExchange property ID" },
      periods: { type: "array", description: "Availability periods to set", items: { type: "object", properties: { start: { type: "string", description: "Start date YYYY-MM-DD" }, end: { type: "string", description: "End date YYYY-MM-DD" }, status: { type: "number", description: "1=available, 2=unavailable, 3=maybe" } }, required: ["start", "end", "status"] } },
    }, required: ["homeId", "periods"] },
  },
  { name: "he_update_home", description: "Update property details (capacity, min_nights, features, etc.). IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { homeId: { type: "number", description: "HomeExchange property ID" }, fields: { type: "object", description: "Fields to update" } }, required: ["homeId", "fields"] } },
  { name: "he_update_description", description: "Update property description texts (title, good_feature, good_place, other). IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { homeId: { type: "number", description: "HomeExchange property ID" }, title: { type: "string" }, good_feature: { type: "string" }, good_place: { type: "string" }, other: { type: "string" }, locale: { type: "string", description: "Language code (default: fr)" } }, required: ["homeId"] } },
  { name: "he_get_who_favorited_me", description: "Get users/homes that have favorited one of your properties. Useful to find potential exchange partners.", inputSchema: { type: "object" as const, properties: { homeId: { type: "number", description: "Your property ID" }, page: { type: "number", description: "Page number (default: 1)" }, limit: { type: "number", description: "Results per page (default: 20)" } }, required: ["homeId"] } },
  { name: "he_get_saved_searches", description: "Get all saved searches", inputSchema: { type: "object" as const, properties: {} } },
  { name: "he_get_saved_search", description: "Get details of a specific saved search", inputSchema: { type: "object" as const, properties: { searchId: { type: "string", description: "Saved search ID" } }, required: ["searchId"] } },
  { name: "he_create_saved_search", description: "Create a saved search from search filters. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { searchData: { type: "object", description: "Search data to save" } }, required: ["searchData"] } },
  { name: "he_delete_saved_search", description: "Delete a saved search. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { searchId: { type: "string", description: "Saved search ID to delete" } }, required: ["searchId"] } },
  { name: "he_get_last_searches", description: "Get search history (last searches performed)", inputSchema: { type: "object" as const, properties: {} } },
  { name: "he_get_cancellation_reasons", description: "Get the list of valid exchange cancellation reasons", inputSchema: { type: "object" as const, properties: {} } },
  { name: "he_get_messages_config", description: "Get messages configuration (templates, auto-messages settings)", inputSchema: { type: "object" as const, properties: {} } },
  { name: "he_batch_archive", description: "Archive multiple conversations at once. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { conversationIds: { type: "array", items: { type: "number" }, description: "Array of conversation IDs to archive" } }, required: ["conversationIds"] } },
  { name: "he_translate_messages_batch", description: "Translate multiple messages at once", inputSchema: { type: "object" as const, properties: { messageIds: { type: "array", items: { type: "number" }, description: "Array of message IDs to translate" }, targetLanguage: { type: "string", description: "Target language code (e.g. 'fr', 'en')" } }, required: ["messageIds", "targetLanguage"] } },
  { name: "he_update_exchange_dates", description: "Update exchange dates for a conversation. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { conversationId: { type: "number", description: "Conversation ID" }, dates: { type: "object", description: "New dates object" } }, required: ["conversationId", "dates"] } },
  { name: "he_auth_status", description: "Check the current authentication status (logged in, token expiry, token source)", inputSchema: { type: "object" as const, properties: {} } },
  { name: "he_set_tokens", description: "Inject access_token (and optionally refresh_token) for authentication. Get from browser DevTools → Application → Cookies → homeexchange.fr", inputSchema: { type: "object" as const, properties: { accessToken: { type: "string", description: "The oidc_access_token cookie value" }, refreshToken: { type: "string", description: "The refresh_token cookie value (optional)" } }, required: ["accessToken"] } },
  { name: "he_refresh_token", description: "Manually trigger a token refresh using the stored PHPSESSID session cookie. Useful to test auto-renewal or force a new token before expiry. Only works if HE_COOKIES was used with a PHPSESSID value.", inputSchema: { type: "object" as const, properties: {} } },
  { name: "he_set_cookies", description: "Inject a raw cookie string from the browser. Must contain oidc_access_token (or access_token). Include PHPSESSID to enable automatic token renewal. Get all cookies from DevTools → Application → Cookies → homeexchange.fr", inputSchema: { type: "object" as const, properties: { cookies: { type: "string", description: 'Raw cookie string (e.g. "oidc_access_token=eyJ...; PHPSESSID=abc123")' } }, required: ["cookies"] } },
];

// ─── Server factory ───────────────────────────────────────────────────────────────────

export function createServer(auth: HomeExchangeAuth, api: HomeExchangeApi): Server {
  const server = new Server(
    { name: "homeexchange-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "he_get_home": { const { homeId } = HomeIdSchema.parse(args); return textResult(await api.getHome(homeId)); }
        case "he_get_calendar": { const { homeId } = HomeIdSchema.parse(args); return textResult(await api.getHomeCalendar(homeId)); }
        case "he_get_calendar_batch": { const { homeIds } = CalendarBatchSchema.parse(args); return textResult(await api.getHomeCalendarBatch(homeIds)); }
        case "he_get_ratings": { const { homeId } = HomeIdSchema.parse(args); return textResult(await api.getHomeRatings(homeId)); }
        case "he_get_favorites": return textResult(await api.getFavorites());
        case "he_get_conversations": { const { filter, first, after } = ConversationsSchema.parse(args); return textResult(await api.getConversations(filter, first, after)); }
        case "he_get_messages": { const { conversationId, limit, offset } = MessagesSchema.parse(args); return textResult(await api.getMessages(conversationId, limit, offset)); }
        case "he_get_user": { const { userId } = UserIdSchema.parse(args); return textResult(await api.getUser(userId)); }
        case "he_get_user_achievements": { const { userId } = UserIdSchema.parse(args); return textResult(await api.getUserAchievements(userId)); }
        case "he_get_user_ratings": { const { userId, limit } = UserRatingsSchema.parse(args); return textResult(await api.getUserRatings(userId, limit)); }
        case "he_get_my_homes": return textResult(await api.getMyHomes());
        case "he_get_my_exchanges": { const { filter, limit, offset } = ExchangesSchema.parse(args); return textResult(await api.getMyExchanges(filter, limit, offset)); }
        case "he_get_conversation": { const { conversationId } = ConversationIdSchema.parse(args); return textResult(await api.getConversation(conversationId)); }
        case "he_get_conversation_stats": return textResult(await api.getConversationStats());
        case "he_translate_message": { const { messageId, targetLanguage } = TranslateMessageSchema.parse(args); return textResult(await api.translateMessage(messageId, targetLanguage)); }
        case "he_search_conversations": { const { query } = SearchConversationsSchema.parse(args); return textResult(await api.searchConversations(query)); }
        case "he_search_homes": { const { filters, offset, limit, min_response_rate } = SearchHomesSchema.parse(args); return textResult(await api.searchHomes(filters, offset, limit, min_response_rate)); }
        case "he_get_subscription": return textResult(await api.getSubscription());
        case "he_get_favorites_full": { const { page, limit } = PaginationSchema.parse(args); return textResult(await api.getFavoritesFull(page, limit)); }
        case "he_get_wishlists": { const { page, limit } = PaginationSchema.parse(args); return textResult(await api.getWishlists(page, limit)); }
        case "he_add_favorite": { const { homeId, wishlistId } = AddFavoriteSchema.parse(args); return textResult(await api.addFavorite(homeId, wishlistId)); }
        case "he_remove_favorite": { const { homeId } = HomeIdSchema.parse(args); return textResult(await api.removeFavorite(homeId)); }
        case "he_archive_conversation": { const { conversationId } = ConversationIdSchema.parse(args); return textResult(await api.archiveConversation(conversationId)); }
        case "he_unarchive_conversation": { const { conversationId } = ConversationIdSchema.parse(args); return textResult(await api.unarchiveConversation(conversationId)); }
        case "he_pre_approve_exchange": { const { conversationId } = ConversationIdSchema.parse(args); return textResult(await api.preApproveExchange(conversationId)); }
        case "he_cancel_exchange": { const { conversationId, reason } = CancelExchangeSchema.parse(args); return textResult(await api.cancelExchange(conversationId, reason)); }
        case "he_rate_home": { const { conversationId, clean, expectation, communication, feedback } = RateHomeSchema.parse(args); return textResult(await api.rateHome(conversationId, { clean, expectation, communication, feedback })); }
        case "he_send_message": { const { conversationId, content } = SendMessageSchema.parse(args); return textResult(await api.sendMessage(conversationId, content)); }
        case "he_send_first_message": { const { receiverId, homeId, content, startOn, endOn, nbGuest, exchangeType } = SendFirstMessageSchema.parse(args); return textResult(await api.sendFirstMessage(receiverId, homeId, content, startOn, endOn, nbGuest, exchangeType)); }
        case "he_update_calendar": { const { homeId, periods } = UpdateCalendarSchema.parse(args); return textResult(await api.updateCalendar(homeId, periods)); }
        case "he_update_home": { const { homeId, fields } = UpdateHomeSchema.parse(args); return textResult(await api.updateHome(homeId, fields)); }
        case "he_update_description": { const { homeId, ...desc } = UpdateDescriptionSchema.parse(args); return textResult(await api.updateHomeDescription(homeId, desc)); }
        case "he_get_who_favorited_me": { const { homeId, page, limit } = WhoFavoritedMeSchema.parse(args); return textResult(await api.getWhoFavoritedMe(homeId, page, limit)); }
        case "he_get_saved_searches": return textResult(await api.getSavedSearches());
        case "he_get_saved_search": { const { searchId } = SavedSearchIdSchema.parse(args); return textResult(await api.getSavedSearch(searchId)); }
        case "he_create_saved_search": { const { searchData } = CreateSavedSearchSchema.parse(args); return textResult(await api.createSavedSearch(searchData)); }
        case "he_delete_saved_search": { const { searchId } = SavedSearchIdSchema.parse(args); return textResult(await api.deleteSavedSearch(searchId)); }
        case "he_get_last_searches": return textResult(await api.getLastSearches());
        case "he_get_cancellation_reasons": return textResult(await api.getCancellationReasons());
        case "he_get_messages_config": return textResult(await api.getMessagesConfig());
        case "he_batch_archive": { const { conversationIds } = BatchArchiveSchema.parse(args); return textResult(await api.batchArchiveConversations(conversationIds)); }
        case "he_translate_messages_batch": { const { messageIds, targetLanguage } = TranslateMessagesBatchSchema.parse(args); return textResult(await api.translateMessagesBatch(messageIds, targetLanguage)); }
        case "he_update_exchange_dates": { const { conversationId, dates } = UpdateExchangeDatesSchema.parse(args); return textResult(await api.updateExchangeDates(conversationId, dates)); }
        case "he_auth_status": return textResult(auth.getStatus());
        case "he_set_tokens": { const { accessToken, refreshToken } = SetTokensSchema.parse(args); auth.setTokens(accessToken, refreshToken); return textResult({ success: true, message: "Tokens set successfully", ...auth.getStatus() }); }
        case "he_refresh_token": { const refreshed = await auth.tryRefresh(); return textResult({ success: refreshed, message: refreshed ? "Token refreshed successfully" : "Refresh failed — no PHPSESSID stored or session expired", ...auth.getStatus() }); }
        case "he_set_cookies": { const { cookies } = SetCookiesSchema.parse(args); auth.setCookies(cookies); return textResult({ success: true, message: "Tokens extracted from cookies successfully", ...auth.getStatus() }); }
        default: return errorResult(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[server] Tool ${name} error:`, msg);
      return errorResult(msg);
    }
  });

  return server;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}
