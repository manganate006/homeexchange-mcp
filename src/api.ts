import { HomeExchangeAuth } from "./auth.js";
import type {
  HomeData,
  CalendarData,
  Rating,
  ConversationsResponse,
  MessagesResponse,
} from "./types.js";

const BFF_BASE = "https://bff.homeexchange.com";
const API_BASE = "https://api.homeexchange.com";

export class HomeExchangeApi {
  private auth: HomeExchangeAuth;
  private readDelay: number;
  private writeDelay: number;
  private messageDelay: number;
  private lastRequestAt = 0;
  private lastMessageAt = 0;
  /** Cache of the authenticated user's home IDs (lazy-loaded). */
  private myHomeIdsCache: number[] | null = null;
  /** Generic TTL cache for read responses. Key = method:params, value = slimmed result. */
  private cache = new Map<string, { data: unknown; expiresAt: number }>();
  private readonly convsTtl: number;
  private readonly staticTtl: number;

  constructor(auth: HomeExchangeAuth, readDelay = 500, writeDelay = 2000, messageDelay = 60_000) {
    this.auth = auth;
    this.readDelay = readDelay;
    this.writeDelay = writeDelay;
    this.messageDelay = messageDelay;
    this.convsTtl = parseInt(process.env.HE_CACHE_TTL_CONVERSATIONS || "180000", 10); // 3 min
    this.staticTtl = parseInt(process.env.HE_CACHE_TTL_STATIC || "1800000", 10); // 30 min
    console.error(`[api] Rate limits: GET=${readDelay}ms, write=${writeDelay}ms, message=${messageDelay}ms`);
    console.error(`[api] Cache TTL: conversations=${this.convsTtl}ms, static=${this.staticTtl}ms`);
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  /** Get full property details from BFF. */
  async getHome(homeId: number): Promise<HomeData> {
    return this.get(`${BFF_BASE}/v1/homes/${homeId}`, "bff");
  }

  /** Get property availability calendar. */
  async getHomeCalendar(homeId: number): Promise<CalendarData> {
    return this.get(`${API_BASE}/v1/homes/${homeId}/calendar`, "api");
  }

  /** Get calendars for multiple homes sequentially (respects rate limiting). */
  async getHomeCalendarBatch(homeIds: number[]): Promise<Record<number, unknown>> {
    const results: Record<number, unknown> = {};
    for (const homeId of homeIds) {
      try {
        results[homeId] = await this.getHomeCalendar(homeId);
      } catch (e) {
        results[homeId] = { error: (e as Error).message };
      }
    }
    return results;
  }

  /** Get property ratings/reviews. */
  async getHomeRatings(homeId: number): Promise<Rating[]> {
    return this.get(`${API_BASE}/v1/homes/${homeId}/ratings`, "api");
  }

  /** Get authenticated user's favorite property IDs. */
  async getFavorites(): Promise<unknown> {
    return this.get(`${BFF_BASE}/favorites/ids`, "bff");
  }

  /** Get conversations list (slimmed). `fields` restricts which field groups are included per item. */
  async getConversations(
    filter: string = "ALL",
    first = 10,
    after = 0,
    fields: string[] = []
  ): Promise<unknown> {
    const cacheKey = `convs:${filter}:${first}:${after}`;
    const cached = this.getCached<unknown>(cacheKey);
    if (cached !== null) {
      console.error(`[api] cache hit: ${cacheKey}`);
      return fields.length ? this.filterConversationFields(cached, fields) : cached;
    }
    // API ignores numeric `after` (expects GraphQL cursor) — fetch enough
    // items to cover the requested page and slice client-side.
    const fetchCount = after + first;
    const params = new URLSearchParams({
      filter,
      first: String(fetchCount),
    });
    const raw = await this.get(
      `${API_BASE}/v3/conversations/me?${params}`,
      "api"
    ) as ConversationsResponse;
    const result = this.slimConversationsResponse(raw, first, after);
    this.setCached(cacheKey, result, this.convsTtl);
    return fields.length ? this.filterConversationFields(result, fields) : result;
  }

  /** Apply field-group filtering to a slimmed conversations response. */
  private filterConversationFields(result: unknown, fields: string[]): unknown {
    const r = result as Record<string, unknown>;
    const convs = r.conversations as Record<string, unknown>[];
    if (!Array.isArray(convs)) return result;
    const filtered = convs.map((c) => {
      const out: Record<string, unknown> = { id: c.id };
      if (fields.includes("meta")) {
        out.title = c.title;
        out.created_at = c.created_at;
        out.updated_at = c.updated_at;
      }
      if (fields.includes("stats")) {
        out.message_count = c.message_count;
        out.unread_messages_count = c.unread_messages_count;
      }
      if (fields.includes("last_message")) out.last_message = c.last_message;
      if (fields.includes("exchanges")) out.exchanges = c.exchanges;
      return out;
    });
    return { ...r, conversations: filtered };
  }

  /** Strip verbose fields from conversations to stay within context limits. */
  private slimConversationsResponse(
    raw: ConversationsResponse,
    first: number,
    after: number
  ): unknown {
    const conn = raw?.data?.conversations;
    const edges = conn?.edges;
    if (!Array.isArray(edges)) return raw;

    const total = conn.totalCount ?? edges.length;
    const paged = edges.slice(after);
    const page = paged.slice(0, first);
    const hasMore = conn.pageInfo?.hasNextPage ?? (paged.length > first);

    const slim = page.map((edge) => {
      const c = edge.node ?? (edge as unknown as Record<string, unknown>);
      const conv = c as unknown as Record<string, unknown>;
      const lastMsg = conv.last_message as Record<string, unknown> | undefined;
      const author = lastMsg?.author as Record<string, unknown> | undefined;
      const exchanges = conv.exchanges as Record<string, unknown>[] | undefined;
      const content = lastMsg?.content as string | undefined;
      return {
        id: conv.id,
        title: conv.title,
        message_count: conv.message_count,
        unread_messages_count: conv.unread_messages_count,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        last_message: lastMsg
          ? {
              id: lastMsg.id,
              content: content && content.length > 200
                ? content.slice(0, 200) + "…"
                : content,
              send_at: lastMsg.send_at,
              author: author
                ? { id: author.id, first_name: author.first_name }
                : undefined,
            }
          : undefined,
        exchanges: Array.isArray(exchanges)
          ? exchanges.map((ex) => ({
              id: ex.id,
              start_on: ex.start_on,
              end_on: ex.end_on,
              type: ex.type,
              status: ex.status,
            }))
          : undefined,
      };
    });

    return {
      total,
      returned: slim.length,
      first,
      after,
      has_more: hasMore,
      next_after: hasMore ? after + first : undefined,
      conversations: slim,
    };
  }

  /** Get messages from a conversation. */
  async getMessages(conversationId: number, limit?: number, offset?: number): Promise<MessagesResponse> {
    const params = new URLSearchParams({ conversation_id: String(conversationId) });
    if (limit !== undefined) params.set("limit", String(limit));
    if (offset !== undefined) params.set("offset", String(offset));
    return this.get(`${API_BASE}/v3/messages?${params}`, "api");
  }

  // ─── Read (User) ──────────────────────────────────────────────────────────

  /** Get user profile by ID. */
  async getUser(userId: number): Promise<unknown> {
    return this.get(`${API_BASE}/v1/users/${userId}`, "api");
  }

  /** Get user GuestPoints / loyalty achievements. */
  async getUserAchievements(userId: number): Promise<unknown> {
    return this.get(`${API_BASE}/v1/achievement/${userId}`, "api");
  }

  /** Get ratings/reviews about a user. */
  async getUserRatings(userId: number, limit = 50): Promise<unknown> {
    return this.get(
      `${API_BASE}/v1/ratings/${userId}?limit=${limit}`,
      "api"
    );
  }

  // ─── Read (Homes) ────────────────────────────────────────────────────────

  /** Get authenticated user's homes. */
  async getMyHomes(): Promise<unknown> {
    return this.get(`${API_BASE}/v1/homes/me`, "api");
  }

  /** Get the authenticated user's home IDs (cached after first call). */
  private async getMyHomeIds(): Promise<number[]> {
    if (this.myHomeIdsCache) return this.myHomeIdsCache;
    const homes = await this.getMyHomes();
    const list = Array.isArray(homes)
      ? homes
      : ((homes as Record<string, unknown>)?.data as unknown[]) ?? [];
    const ids = list
      .map((h) => (h as Record<string, unknown>)?.id)
      .filter((id): id is number => typeof id === "number");
    this.myHomeIdsCache = ids;
    return ids;
  }

  /**
   * Check the exchange state for a conversation: which of my homes is attached
   * and what exchange type (1=reciprocal, 2=guestpoints) is active.
   * Tries multiple JSON paths since the v3 API structure can vary.
   */
  private async checkExchangeState(
    conversationId: number
  ): Promise<{ homeId: number | null; type: number | null }> {
    const myIds = await this.getMyHomeIds();
    const conv = (await this.getConversation(conversationId)) as Record<string, unknown>;
    // Try multiple paths — v3 may return data.conversation.exchanges or conversation.exchanges
    const convData =
      ((conv as any)?.data?.conversation) ??
      (conv as any)?.conversation ??
      conv;
    const exchanges: unknown[] = (convData as any)?.exchanges ?? [];

    console.error(`[api] checkExchangeState: conv ${conversationId}, ${exchanges.length} exchange(s), myIds=${JSON.stringify(myIds)}`);

    let matchedHomeId: number | null = null;
    let bestType: number | null = null;

    for (const ex of exchanges) {
      const exObj = ex as Record<string, unknown>;
      const rawType = exObj?.type ?? exObj?.exchange_type;
      const exType = typeof rawType === "number" ? rawType : null;

      // Try home.id (object), home as number (flat), home_id, homeId
      const home = exObj?.home;
      const homeId: number | null =
        (typeof home === "object" && home !== null ? (home as any).id : null) ??
        (typeof home === "number" ? home : null) ??
        (typeof exObj?.home_id === "number" ? (exObj.home_id as number) : null) ??
        (typeof exObj?.homeId === "number" ? (exObj.homeId as number) : null) ??
        null;

      // Debug: log each exchange leg
      console.error(`[api]   ex ${exObj?.id ?? "?"}: type=${exType}, homeId=${homeId}, raw home=${typeof home === "object" ? JSON.stringify(home) : home}`);

      if (typeof homeId === "number" && myIds.includes(homeId)) {
        matchedHomeId = homeId;
        bestType = exType;
        break; // exact match — use this
      }

      // Track the type even when home doesn't match (v3 API may not include home in exchanges)
      if (exType !== null) bestType = exType;
    }

    return { homeId: matchedHomeId, type: bestType };
  }

  /**
   * Resolve which of my homes is attached to a conversation's exchange.
   * Wrapper around checkExchangeState for backward compat.
   */
  private async resolveAttachedHome(conversationId: number): Promise<number | null> {
    const state = await this.checkExchangeState(conversationId);
    return state.homeId;
  }

  // ─── Read (Exchanges) ────────────────────────────────────────────────────

  /** Get user's exchanges with filter. */
  async getMyExchanges(
    filter: "upcoming" | "ongoing" | "past" = "upcoming",
    limit = 20,
    offset = 0
  ): Promise<unknown> {
    const params = new URLSearchParams({
      filter,
      limit: String(limit),
      offset: String(offset),
    });
    return this.get(
      `${API_BASE}/v1/exchanges/user/me?${params}`,
      "api"
    );
  }

  // ─── Read (Conversations enriched) ───────────────────────────────────────

  /** Get single conversation details. Slims the response to avoid token overflow. */
  async getConversation(conversationId: number): Promise<unknown> {
    const cacheKey = `conv:${conversationId}`;
    const cached = this.getCached<unknown>(cacheKey);
    if (cached !== null) {
      console.error(`[api] cache hit: ${cacheKey}`);
      return cached;
    }
    try {
      const raw = await this.get<unknown>(
        `${API_BASE}/v3/conversations/me/${conversationId}`,
        "api"
      );
      const result = this.slimConversationDetail(raw);
      this.setCached(cacheKey, result, this.convsTtl);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.includes("conversations.not_found")) {
        // Exchange-type conversations are not in the regular v3 endpoint — try BFF
        console.error(`[api] getConversation: 404 on v3, trying BFF exchange/v2 for ${conversationId}`);
        const raw = await this.get<unknown>(
          `${BFF_BASE}/exchange/v2/${conversationId}`,
          "bff"
        );
        const result = this.slimConversationDetail(raw);
        this.setCached(cacheKey, result, this.convsTtl);
        return result;
      }
      throw err;
    }
  }

  /** Strip verbose fields (photos, long descriptions, full profiles) from a conversation detail response. */
  private slimConversationDetail(raw: unknown): unknown {
    const r = raw as Record<string, unknown>;
    // Unwrap various response shapes: { data: { conversation } }, { conversation }, or flat
    const conv: Record<string, unknown> =
      ((r?.data as any)?.conversation) ?? r?.conversation ?? r ?? {};

    const participants = (conv.participants ?? conv.members) as unknown[] | undefined;
    const slimParticipants = Array.isArray(participants)
      ? participants.map((p: unknown) => {
          const u = p as Record<string, unknown>;
          return {
            id: u.id,
            first_name: u.first_name,
            last_name: u.last_name,
            profile_picture: u.profile_picture ?? u.avatar,
          };
        })
      : undefined;

    const lastMsg = conv.last_message as Record<string, unknown> | undefined;
    const msgAuthor = lastMsg?.author as Record<string, unknown> | undefined;
    const msgContent = lastMsg?.content as string | undefined;
    const slimLastMsg = lastMsg
      ? {
          id: lastMsg.id,
          content: msgContent && msgContent.length > 300 ? msgContent.slice(0, 300) + "…" : msgContent,
          send_at: lastMsg.send_at,
          author: msgAuthor ? { id: msgAuthor.id, first_name: msgAuthor.first_name } : undefined,
        }
      : undefined;

    const exchanges = conv.exchanges as unknown[] | undefined;
    const slimExchanges = Array.isArray(exchanges)
      ? exchanges.map((ex: unknown) => {
          const e = ex as Record<string, unknown>;
          const home = e.home as Record<string, unknown> | undefined;
          const senderHome = e.sender_home as Record<string, unknown> | undefined;
          return {
            id: e.id,
            status: e.status,
            type: e.type ?? e.exchange_type,
            start_on: e.start_on,
            end_on: e.end_on,
            nb_guest: e.nb_guest ?? e.nb_guests,
            home: home ? { id: home.id, title: home.title } : undefined,
            sender_home: senderHome ? { id: senderHome.id, title: senderHome.title } : undefined,
          };
        })
      : undefined;

    return {
      id: conv.id,
      title: conv.title,
      status: conv.status,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      message_count: conv.message_count,
      unread_messages_count: conv.unread_messages_count,
      participants: slimParticipants,
      last_message: slimLastMsg,
      exchanges: slimExchanges,
    };
  }

  /** Get conversation stats (unread counts etc.). */
  async getConversationStats(): Promise<unknown> {
    return this.get(`${API_BASE}/v1/conversations/stats/me`, "api");
  }

  /** Translate a message to a target language. */
  async translateMessage(
    messageId: number,
    targetLanguage: string
  ): Promise<unknown> {
    return this.get(
      `${API_BASE}/v1/messages/${messageId}/translate?target_language=${encodeURIComponent(targetLanguage)}`,
      "api"
    );
  }

  /** Search conversations. */
  async searchConversations(query: string): Promise<unknown> {
    return this.post(
      `${API_BASE}/v1/conversations/search`,
      "api",
      { query }
    );
  }

  // ─── Read (Search) ───────────────────────────────────────────────────────

  /** Search homes via BFF (v2 search API). Returns slimmed results (no full descriptions/images). */
  async searchHomes(
    filters: Record<string, unknown>,
    offset = 0,
    limit = 20,
    minResponseRate?: number
  ): Promise<unknown> {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });
    // The BFF v2 search expects { search_query: { ... } } wrapper
    // If caller already wrapped it, use as-is; otherwise wrap it
    const body = filters.search_query
      ? filters
      : { search_query: filters };
    const raw = await this.post(
      `${BFF_BASE}/search/homes?${params}`,
      "bff",
      body,
      {
        "X-SEARCH-API-VERSION": "v2",
        "X-LEGACY-RESPONSE": "true",
      }
    ) as Record<string, unknown>;
    return this.slimSearchResponse(raw, offset, limit, minResponseRate);
  }

  /** Strip verbose fields from search results to stay within context limits. */
  private slimSearchResponse(raw: Record<string, unknown>, offset: number, limit: number, minResponseRate?: number): unknown {
    const homes = (raw?.homes ?? raw?.data ?? raw) as unknown[];
    if (!Array.isArray(homes)) return raw;

    const filtered = minResponseRate !== undefined
      ? homes.filter((h: unknown) => {
          const rate = ((h as Record<string, unknown>).user as Record<string, unknown>)?.response_rate;
          return rate === undefined || Number(rate) >= minResponseRate;
        })
      : homes;

    const slim = filtered.map((h: unknown) => {
      const home = h as Record<string, unknown>;
      const user = home.user as Record<string, unknown> | undefined;
      const detail = home.detail as Record<string, unknown> | undefined;
      const descriptions = home.descriptions as Record<string, unknown>[] | undefined;
      const images = home.images as unknown[] | undefined;
      const feature = home.feature as Record<string, unknown> | undefined;
      return {
        id: home.id,
        type: home.type,
        capacity: home.capacity,
        guestpoint: home.guestpoint,
        global_rating: home.global_rating,
        min_nights: home.min_nights,
        prefers_reciprocal: home.prefers_reciprocal,
        is_he_collection: home.is_he_collection,
        contact_allowed: home.contact_allowed,
        location: home.location,
        translated_admins: home.translated_admins,
        user: user ? {
          id: user.id,
          name: user.name,
          exchange_nb: user.exchange_nb,
          global_rating: user.global_rating,
          is_identity_verified: user.is_identity_verified,
          response_rate: user.response_rate,
        } : undefined,
        detail: detail ? {
          bedrooms_nb: detail.bedrooms_nb,
          bathrooms_nb: detail.bathrooms_nb,
          size: detail.size,
        } : undefined,
        feature: feature ? {
          multimedia: feature.multimedia,
          practical: feature.practical,
          outdoor: feature.outdoor,
          kids: feature.kids,
          transport: feature.transport,
        } : undefined,
        title: descriptions?.find((d: Record<string, unknown>) => d.locale === "fr")?.title
          ?? descriptions?.[0]?.title,
        cover_image: (images as Array<Record<string, unknown>>)?.[0]?.url,
        total_count: raw.total_count ?? raw.totalCount,
      };
    });

    return {
      total_count: (raw as Record<string, unknown>).total_count ?? (raw as Record<string, unknown>).totalCount,
      returned: slim.length,
      offset,
      limit,
      ...(minResponseRate !== undefined && { min_response_rate_filter: minResponseRate }),
      homes: slim,
    };
  }

  // ─── Read (Subscription) ─────────────────────────────────────────────────

  /** Get subscription info. */
  async getSubscription(): Promise<unknown> {
    return this.get(`${API_BASE}/v1/subscription`, "api");
  }

  // ─── Read (Favorites enriched) ───────────────────────────────────────────

  /** Get all favorites with full details. */
  async getFavoritesFull(page = 1, limit = 20): Promise<unknown> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      format: "full",
    });
    return this.get(`${BFF_BASE}/favorites?${params}`, "bff");
  }

  /** Get wishlists (favorite folders). */
  async getWishlists(page = 1, limit = 20): Promise<unknown> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    return this.get(`${BFF_BASE}/wishlists?${params}`, "bff");
  }

  // ─── Read (New tools) ────────────────────────────────────────────────────

  /** Get homes that have favorited one of our properties. */
  async getWhoFavoritedMe(
    homeId: number,
    page = 1,
    limit = 20
  ): Promise<unknown> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    return this.get(
      `${BFF_BASE}/favorites/homes/${homeId}/homecards?${params}`,
      "bff"
    );
  }

  /** Get saved searches. */
  async getSavedSearches(): Promise<unknown> {
    return this.get(`${BFF_BASE}/search/saved-searches?limit=100`, "bff");
  }

  /** Get a specific saved search by ID. */
  async getSavedSearch(searchId: string): Promise<unknown> {
    return this.get(
      `${BFF_BASE}/search/saved-searches/${searchId}`,
      "bff"
    );
  }

  /** Create a saved search. */
  async createSavedSearch(
    searchData: Record<string, unknown>
  ): Promise<unknown> {
    return this.post(
      `${BFF_BASE}/search/saved-searches`,
      "bff",
      searchData
    );
  }

  /** Delete a saved search. */
  async deleteSavedSearch(searchId: string): Promise<unknown> {
    return this.del(
      `${BFF_BASE}/search/saved-searches/${searchId}`,
      "bff"
    );
  }

  /** Get last searches (history). */
  async getLastSearches(version = 2): Promise<unknown> {
    return this.get(
      `${API_BASE}/v1/search/last?version=${version}`,
      "api"
    );
  }

  /** Get exchange cancellation reasons. */
  async getCancellationReasons(): Promise<unknown> {
    return this.get(
      `${API_BASE}/v1/exchanges/cancellation_reasons`,
      "api"
    );
  }

  /** Get messages config (templates, etc.). */
  async getMessagesConfig(): Promise<unknown> {
    return this.get(`${API_BASE}/v3/messages/config`, "api");
  }

  // ─── Write (Batch) ─────────────────────────────────────────────────────

  /** Batch archive conversations. May return 204 No Content — we wrap with a confirmation. */
  async batchArchiveConversations(ids: number[]): Promise<unknown> {
    await this.patch(
      `${API_BASE}/v1/conversations/batch/archive`,
      "api",
      { ids }
    );
    this.invalidateCache("conv");
    return { success: true, conversationIds: ids, action: "archived", count: ids.length };
  }

  /** Batch translate messages. */
  async translateMessagesBatch(
    ids: number[],
    targetLanguage: string
  ): Promise<unknown> {
    return this.post(
      `${API_BASE}/v1/messages/translations`,
      "api",
      { ids, target_language: targetLanguage }
    );
  }

  /** Update exchange dates. */
  async updateExchangeDates(
    conversationId: number,
    dates: Record<string, unknown>
  ): Promise<unknown> {
    return this.post(
      `${BFF_BASE}/exchange/${conversationId}/update-dates`,
      "bff",
      dates
    );
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  /**
   * Send a message in a conversation.
   * Endpoint: POST https://api.homeexchange.com/v1/messages
   * Body: { conversation, content }
   */
  async sendMessage(
    conversationId: number,
    content: string
  ): Promise<unknown> {
    await this.messageThrottle();
    const result = await this.post(`${API_BASE}/v1/messages`, "api", {
      conversation: conversationId,
      content,
    });
    this.invalidateCache("conv");
    return result;
  }

  /**
   * Send a first contact message to a property owner.
   * Creates a new conversation.
   * exchange_type: 1=reciprocal, 2=guestpoints (depends on calendar availability)
   */
  async sendFirstMessage(
    receiverId: number,
    homeId: number,
    content: string,
    startOn: string,
    endOn: string,
    nbGuest: number,
    exchangeType?: number,
    senderHomeId?: number
  ): Promise<unknown> {
    // ── Message throttle (60s between sends) ───────────────────
    await this.messageThrottle();

    // ── Pre-flight checks ──────────────────────────────────────
    try {
      const [home, calendar] = await Promise.all([
        this.getHome(homeId),
        this.getHomeCalendar(homeId),
      ]);

      const start = new Date(startOn);
      const end = new Date(endOn);
      // API returns { data: [{ start_on, end_on, type: "BOOKED"|"AVAILABLE"|"RECIPROCAL"|"NON_RECIPROCAL" }] }
      const periods: any[] = (calendar as any).data ?? (calendar as any).periods ?? [];
      const overlapping = periods.filter((p: any) => {
        const pStart = new Date(p.start_on ?? p.start);
        const pEnd = new Date(p.end_on ?? p.end);
        const pType = p.type ?? p.status;
        return pType !== "BOOKED" && pType !== 2 && pStart < end && pEnd > start;
      });
      const calendarOpen = overlapping.length > 0;

      if (!calendarOpen && !home.contact_allowed) {
        return {
          error: "contact_blocked",
          message: `Home ${homeId} has no open dates between ${startOn} and ${endOn}, and the owner only accepts contact when dates are explicitly open.`,
          homeId,
          contact_allowed: false,
          requested: { startOn, endOn },
          calendar_periods: calendar.periods?.slice(0, 10),
        };
      }
    } catch (e) {
      console.error(`[api] sendFirstMessage pre-flight check failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ── Send message ───────────────────────────────────────────
    const body: Record<string, unknown> = {
      receiver: receiverId,
      home: homeId,
      content,
      start_on: startOn,
      end_on: endOn,
      nb_guest: nbGuest,
    };
    if (exchangeType !== undefined) {
      body.exchange_type = exchangeType;
    }
    if (senderHomeId !== undefined) {
      body.sender_home = senderHomeId;
    }
    let result: Record<string, unknown>;
    let fellBackToGP = false;

    try {
      result = await this.post<Record<string, unknown>>(`${API_BASE}/v1/messages`, "api", body);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (exchangeType === 1 && errMsg.includes("400") && errMsg.toLowerCase().includes("calendar")) {
        // Extract the allowed type from the error if present (e.g. "Type available for these dates is integer 3")
        const typeMatch = errMsg.match(/type available[^]*?integer\s+(\d+)/i);
        const fallbackType = typeMatch ? parseInt(typeMatch[1], 10) : 2;
        console.error(`[api] sendFirstMessage: calendar conflict for reciprocal, falling back to type=${fallbackType}. Error: ${errMsg}`);
        body.exchange_type = fallbackType;
        // keep body.sender_home = senderHomeId so HE creates an exchange with the correct home attached
        result = await this.post<Record<string, unknown>>(`${API_BASE}/v1/messages`, "api", body);
        fellBackToGP = true;
      } else {
        throw e;
      }
    }

    // If reciprocal requested, attempt conversion via BFF with retry
    if (exchangeType === 1 && senderHomeId) {
      const conv = result.conversation as Record<string, unknown> | undefined;
      const convId = conv?.id;
      console.error(`[api] sendFirstMessage: reciprocal requested, convId=${convId}, fellBackToGP=${fellBackToGP}, result keys=${Object.keys(result).join(",")}`);
      if (conv) console.error(`[api] sendFirstMessage: conv keys=${Object.keys(conv).join(",")}, exchanges=${JSON.stringify((conv as any).exchanges ?? "none")}`);
      if (convId) {
        const conversion = await this.attemptReciprocalConversion(convId as number, senderHomeId);
        this.invalidateCache("conv");
        return {
          ...result,
          _reciprocal_conversion: {
            ...conversion,
            ...(fellBackToGP
              ? { calendar_fallback: true, note: "Sent as GuestPoints due to calendar conflict, then attempted reciprocal conversion" }
              : {}),
          },
        };
      }
    }

    this.invalidateCache("conv");
    return result;
  }

  /**
   * After a first message, confirm the exchange is reciprocal.
   *
   * The reciprocal leg is created server-side by the POST /v1/messages itself
   * (it depends on dates/availability and on the offered home being eligible —
   * e.g. a verified home). The `change-to-reciprocal` BFF endpoint only *confirms*
   * the home already attached to my side of the conversation; it cannot create a
   * leg from nothing (that returns a generic 500). So we poll briefly for the
   * attached home rather than hammering a doomed 500.
   */
  private async attemptReciprocalConversion(
    conversationId: number,
    senderHomeId: number,
    maxRetries = 2,
    delays = [3_000, 6_000]
  ): Promise<{ success: boolean; attempts: number; home_used?: number; error?: string }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const delayMs = delays[attempt - 1] ?? delays[delays.length - 1];
      console.error(`[api] reciprocal: waiting ${delayMs / 1000}s before check ${attempt}/${maxRetries}...`);
      await sleep(delayMs);

      const state = await this.checkExchangeState(conversationId).catch(() => ({ homeId: null, type: null }));

      // Already reciprocal (type=1) — success regardless of home match
      if (state.type === 1) {
        if (state.homeId !== null && state.homeId !== senderHomeId) {
          // Reciprocal but wrong home
          console.error(`[api] reciprocal: type=1 but home=${state.homeId} instead of ${senderHomeId}`);
          return {
            success: false,
            attempts: attempt,
            home_used: state.homeId,
            error:
              `Exchange is reciprocal but with home ${state.homeId} instead of ${senderHomeId}. ` +
              `Call he_change_exchange_home to correct.`,
          };
        }
        console.error(`[api] reciprocal: exchange already reciprocal (home=${state.homeId ?? "unknown"})`);
        return { success: true, attempts: attempt, home_used: state.homeId ?? senderHomeId };
      }

      // Home matched but not reciprocal yet — confirm via PATCH
      if (state.homeId === senderHomeId) {
        console.error(`[api] reciprocal: home ${senderHomeId} attached, type=${state.type} — confirming via POST`);
        try {
          await this.patch(
            `${BFF_BASE}/exchange/${conversationId}/change-to-reciprocal/${senderHomeId}`,
            "bff"
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // 409 = already reciprocal — still a success
          if (!msg.includes("409")) console.error(`[api] reciprocal confirm warning: ${msg}`);
        }
        return { success: true, attempts: attempt, home_used: senderHomeId };
      }

      // Wrong home attached (not reciprocal either) — block
      if (state.homeId !== null && state.homeId !== senderHomeId) {
        console.error(`[api] reciprocal: wrong home ${state.homeId} attached (expected ${senderHomeId})`);
        return {
          success: false,
          attempts: attempt,
          home_used: state.homeId,
          error:
            `Server attached home ${state.homeId} instead of ${senderHomeId}. ` +
            `Call he_change_exchange_type with senderHomeId=${senderHomeId} to correct.`,
        };
      }

      // Neither home nor type resolved — exchange data not ready, retry
      console.error(`[api] reciprocal: no exchange data yet (attempt ${attempt}/${maxRetries})`);
    }

    // All retries exhausted — best-effort POST then final verification
    console.error(`[api] reciprocal: retries exhausted — trying direct change-to-reciprocal/${senderHomeId}`);
    try {
      await this.patch(
        `${BFF_BASE}/exchange/${conversationId}/change-to-reciprocal/${senderHomeId}`,
        "bff"
      );
      return { success: true, attempts: maxRetries, home_used: senderHomeId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 409 = already reciprocal — success
      if (msg.includes("409")) return { success: true, attempts: maxRetries, home_used: senderHomeId };
      console.error(`[api] reciprocal best-effort PATCH: ${msg}`);
    }

    // Final verification
    const finalState = await this.checkExchangeState(conversationId).catch(() => ({ homeId: null, type: null }));
    console.error(`[api] reciprocal final check: type=${finalState.type}, homeId=${finalState.homeId}`);
    if (finalState.type === 1) {
      return {
        success: true,
        attempts: maxRetries,
        home_used: finalState.homeId ?? senderHomeId,
      };
    }
    if (finalState.homeId === senderHomeId) {
      return { success: true, attempts: maxRetries, home_used: senderHomeId };
    }

    return {
      success: false,
      attempts: maxRetries,
      error:
        `Exchange not confirmed as reciprocal after ${maxRetries} checks. ` +
        `Use he_change_exchange_type with senderHomeId=${senderHomeId} to retry manually.`,
    };
  }

  /**
   * Update calendar availability periods.
   * Endpoint: PUT https://api.homeexchange.com/v1/homes/{homeId}/calendar
   * Body: { periods: [{ start, end, status }] }
   */
  async updateCalendar(
    homeId: number,
    periods: { start: string; end: string; status: number }[]
  ): Promise<unknown> {
    return this.put(
      `${API_BASE}/v1/homes/${homeId}/calendar`,
      "api",
      { periods }
    );
  }

  /**
   * Update home/property details.
   * Endpoint: PATCH https://bff.homeexchange.com/v1/homes/{homeId}
   * Body: partial home fields
   */
  async updateHome(
    homeId: number,
    fields: Record<string, unknown>
  ): Promise<unknown> {
    return this.patch(`${BFF_BASE}/v1/homes/${homeId}`, "bff", fields);
  }

  /**
   * Update home description.
   * Endpoint: PUT https://bff.homeexchange.com/v1/homes/{homeId}/descriptions
   * Body: description fields
   */
  async updateHomeDescription(
    homeId: number,
    description: {
      title?: string;
      good_feature?: string;
      good_place?: string;
      other?: string;
      locale?: string;
    }
  ): Promise<unknown> {
    return this.put(
      `${BFF_BASE}/v1/homes/${homeId}/descriptions`,
      "bff",
      description
    );
  }

  // ─── Write (Favorites) ────────────────────────────────────────────────────

  /** Add a home to favorites. */
  async addFavorite(
    homeId: number,
    wishlistId?: number
  ): Promise<unknown> {
    const body: Record<string, unknown> = { home_id: homeId };
    if (wishlistId) body.wishlist_id = wishlistId;
    return this.post(`${BFF_BASE}/favorites`, "bff", body);
  }

  /** Remove a home from favorites. */
  async removeFavorite(homeId: number): Promise<unknown> {
    return this.del(`${BFF_BASE}/favorites/${homeId}`, "bff");
  }

  /** Create a new wishlist (favorites folder). */
  async createWishlist(name: string): Promise<unknown> {
    return this.post(`${BFF_BASE}/wishlists`, "bff", { name });
  }

  // ─── Write (Conversations) ──────────────────────────────────────────────

  /** Archive a conversation. Returns 204 No Content — we wrap with a confirmation. */
  async archiveConversation(conversationId: number): Promise<unknown> {
    await this.patch(
      `${API_BASE}/v1/conversations/${conversationId}/archive`,
      "api",
      {}
    );
    this.invalidateCache("conv");
    return { success: true, conversationId, action: "archived" };
  }

  /** Unarchive a conversation. Returns 204 No Content — we wrap with a confirmation. */
  async unarchiveConversation(conversationId: number): Promise<unknown> {
    await this.patch(
      `${API_BASE}/v1/conversations/${conversationId}/unarchive`,
      "api",
      {}
    );
    this.invalidateCache("conv");
    return { success: true, conversationId, action: "unarchived" };
  }

  /** Mark a conversation as favorite. */
  async favoriteConversation(conversationId: number): Promise<unknown> {
    const result = await this.post(
      `${API_BASE}/v1/conversations/${conversationId}/favorite`,
      "api",
      {}
    );
    this.invalidateCache("conv");
    return result;
  }

  /** Remove a conversation from favorites. */
  async unfavoriteConversation(conversationId: number): Promise<unknown> {
    return this.del(
      `${API_BASE}/v1/conversations/${conversationId}/favorite`,
      "api"
    );
  }

  // ─── Write (Exchanges) ──────────────────────────────────────────────────

  /** Pre-approve an exchange via BFF. */
  async preApproveExchange(conversationId: number): Promise<unknown> {
    const result = await this.post(
      `${BFF_BASE}/exchange/${conversationId}/pre-approve`,
      "bff",
      {}
    );
    this.invalidateCache("conv");
    return result;
  }

  /**
   * Switch an exchange to reciprocal.
   * Endpoint: PATCH https://bff.homeexchange.com/exchange/{conversationId}/change-to-reciprocal/{senderHomeId}
   *
   * Checks current state first: if already reciprocal, returns success without calling the BFF.
   * The BFF only accepts {senderHomeId} when it is the home already attached to
   * my side of this conversation (set at first contact). `senderHomeId` is an
   * optional hint, only used as a fallback when no home of mine is attached yet.
   */
  async changeExchangeToReciprocal(
    conversationId: number,
    senderHomeId?: number
  ): Promise<unknown> {
    // Check current state — skip if already reciprocal
    const state = await this.checkExchangeState(conversationId);
    if (state.type === 1) {
      return {
        already_reciprocal: true,
        home_used: state.homeId,
        note: `Exchange is already reciprocal (type=1). No conversion needed.`,
      };
    }

    const attachedHome = state.homeId;

    const homeToUse = attachedHome ?? senderHomeId;
    if (!homeToUse) {
      throw new Error(
        `No home of yours is attached to conversation ${conversationId} ` +
          `(pure GuestPoints conversation). Provide senderHomeId explicitly.`
      );
    }

    try {
      const result = await this.patch<unknown>(
        `${BFF_BASE}/exchange/${conversationId}/change-to-reciprocal/${homeToUse}`,
        "bff"
      );
      return {
        result,
        home_used: homeToUse,
        ...(attachedHome === null ? { attached_home: null } : {}),
        ...(senderHomeId !== undefined && senderHomeId !== homeToUse
          ? { note: `Used home ${homeToUse} attached to conversation (ignored senderHomeId=${senderHomeId}).` }
          : {}),
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // 409 = already reciprocal — treat as success
      if (errMsg.includes("409")) {
        return {
          already_reciprocal: true,
          home_used: homeToUse,
          note: "Exchange is already reciprocal (BFF returned 409 Conflict).",
        };
      }
      throw e;
    }
  }

  /**
   * Change which home is proposed in an exchange.
   * Endpoint: PATCH https://api.homeexchange.com/v1/exchanges/{exchangeId}
   * Use the exchange ID where you are the host, not the conversation ID.
   */
  async changeExchangeHome(
    exchangeId: number,
    homeId: number
  ): Promise<unknown> {
    return this.patch(
      `${API_BASE}/v1/exchanges/${exchangeId}`,
      "api",
      { home: homeId }
    );
  }

  /** Cancel an exchange. */
  async cancelExchange(
    conversationId: number,
    reason: string
  ): Promise<unknown> {
    const result = await this.post(
      `${API_BASE}/v1/exchanges/${conversationId}/cancel`,
      "api",
      { reason }
    );
    this.invalidateCache("conv");
    return result;
  }

  // ─── Write (Ratings) ────────────────────────────────────────────────────

  /** Rate a home after exchange. */
  async rateHome(
    conversationId: number,
    rating: {
      clean: number;
      expectation: number;
      communication: number;
      feedback?: string;
    }
  ): Promise<unknown> {
    return this.post(
      `${API_BASE}/v1/homes/rate/${conversationId}`,
      "api",
      rating
    );
  }

  // ─── Cache helpers ─────────────────────────────────────────────────────────

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.data as T;
    this.cache.delete(key);
    return null;
  }

  private setCached(key: string, data: unknown, ttlMs: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  /** Invalidate cache entries whose key contains `pattern` (or all entries if omitted). */
  invalidateCache(pattern?: string): void {
    if (!pattern) { this.cache.clear(); return; }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) this.cache.delete(key);
    }
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  private async get<T>(url: string, server: "bff" | "api"): Promise<T> {
    return this.request("GET", url, server);
  }

  private async post<T>(
    url: string,
    server: "bff" | "api",
    body: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    return this.request("POST", url, server, body, false, extraHeaders);
  }

  private async put<T>(
    url: string,
    server: "bff" | "api",
    body: unknown
  ): Promise<T> {
    return this.request("PUT", url, server, body);
  }

  private async del<T>(
    url: string,
    server: "bff" | "api"
  ): Promise<T> {
    return this.request("DELETE", url, server);
  }

  private async patch<T>(
    url: string,
    server: "bff" | "api",
    body?: unknown
  ): Promise<T> {
    return this.request("PATCH", url, server, body);
  }

  private async request<T>(
    method: string,
    url: string,
    server: "bff" | "api",
    body?: unknown,
    retried = false,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    // Rate limiting — GET is faster, writes are throttled
    await this.rateLimit(method);

    // Ensure auth
    await this.auth.ensureAuthenticated();

    const isWrite = method !== "GET";
    const headers = {
      ...(isWrite
        ? this.auth.getWriteHeaders(server)
        : this.auth.getHeaders(server)),
      ...extraHeaders,
    };

    const options: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    console.error(`[api] ${method} ${url}`);
    const res = await fetch(url, options);

    // Handle 401 — re-login once
    if (res.status === 401 && !retried) {
      console.error("[api] 401 — re-authenticating...");
      this.auth.invalidate();
      return this.request(method, url, server, body, true);
    }

    // Handle 429 — backoff
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "3", 10);
      console.error(`[api] 429 — waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      return this.request(method, url, server, body, retried);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status} ${res.statusText} for ${method} ${url}: ${text.slice(0, 500)}`
      );
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  private async messageThrottle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastMessageAt;
    if (this.lastMessageAt > 0 && elapsed < this.messageDelay) {
      const waitMs = this.messageDelay - elapsed;
      console.error(`[api] message throttle: waiting ${Math.round(waitMs / 1000)}s before next message send...`);
      await sleep(waitMs);
    }
    this.lastMessageAt = Date.now();
  }

  private async rateLimit(method: string): Promise<void> {
    const delay = method === "GET" ? this.readDelay : this.writeDelay;
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < delay) {
      await sleep(delay - elapsed);
    }
    this.lastRequestAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
