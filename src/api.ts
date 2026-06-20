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
  private requestDelay: number;
  private lastRequestAt = 0;
  /** Cache of the authenticated user's home IDs (lazy-loaded). */
  private myHomeIdsCache: number[] | null = null;

  constructor(auth: HomeExchangeAuth, requestDelay = 1500) {
    this.auth = auth;
    this.requestDelay = requestDelay;
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

  /** Get conversations list (slimmed). */
  async getConversations(
    filter: string = "ALL",
    first = 10,
    after = 0
  ): Promise<unknown> {
    const params = new URLSearchParams({
      filter,
      first: String(first),
      after: String(after),
    });
    const raw = await this.get(
      `${API_BASE}/v3/conversations/me?${params}`,
      "api"
    ) as ConversationsResponse;
    return this.slimConversationsResponse(raw, first, after);
  }

  /** Strip verbose fields from conversations to stay within context limits. */
  private slimConversationsResponse(
    raw: ConversationsResponse,
    first: number,
    after: number
  ): unknown {
    const edges = raw?.data?.conversations?.edges;
    if (!Array.isArray(edges)) return raw;

    // The API may ignore `first` param — enforce client-side
    const paged = edges.slice(after, after + first);
    const total = edges.length;

    const slim = paged.map((edge) => {
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
      has_more: after + first < total,
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
   * Resolve which of my homes is attached to a conversation's exchange.
   * `change-to-reciprocal/{homeId}` only succeeds when {homeId} is the home
   * already paired on my side of the conversation. Returns the attached home ID,
   * or null when no home of mine has a leg yet (pure GuestPoints conversation).
   */
  private async resolveAttachedHome(conversationId: number): Promise<number | null> {
    const myIds = await this.getMyHomeIds();
    const conv = (await this.getConversation(conversationId)) as Record<string, unknown>;
    const exchanges =
      (((conv?.data as Record<string, unknown>)?.conversation as Record<string, unknown>)
        ?.exchanges as unknown[]) ?? [];
    for (const ex of exchanges) {
      const home = (ex as Record<string, unknown>)?.home as Record<string, unknown> | undefined;
      const id = home?.id;
      if (typeof id === "number" && myIds.includes(id)) return id;
    }
    return null;
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

  /** Get single conversation details. */
  async getConversation(conversationId: number): Promise<unknown> {
    return this.get(
      `${API_BASE}/v3/conversations/me/${conversationId}`,
      "api"
    );
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

  /** Batch archive conversations. */
  async batchArchiveConversations(ids: number[]): Promise<unknown> {
    return this.patch(
      `${API_BASE}/v1/conversations/batch/archive`,
      "api",
      { ids }
    );
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
    return this.post(`${API_BASE}/v1/messages`, "api", {
      conversation: conversationId,
      content,
    });
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
        console.error("[api] sendFirstMessage: calendar conflict for reciprocal, falling back to GuestPoints");
        body.exchange_type = 2;
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
      if (convId) {
        const conversion = await this.attemptReciprocalConversion(convId as number, senderHomeId);
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
    maxRetries = 3,
    initialDelayMs = 10_000,
    delayIncrementMs = 5_000
  ): Promise<{ success: boolean; attempts: number; home_used?: number; error?: string }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const delayMs = initialDelayMs + (attempt - 1) * delayIncrementMs;
      console.error(`[api] reciprocal: waiting ${delayMs / 1000}s before check ${attempt}/${maxRetries}...`);
      await sleep(delayMs);

      const attachedHome = await this.resolveAttachedHome(conversationId).catch(() => null);
      if (attachedHome === null) continue; // leg not created yet — wait and re-check

      // A home of mine is attached → the exchange is reciprocal. Confirm idempotently.
      try {
        await this.patch(
          `${BFF_BASE}/exchange/${conversationId}/change-to-reciprocal/${attachedHome}`,
          "bff"
        );
      } catch (e) {
        console.error(`[api] reciprocal confirm warning: ${e instanceof Error ? e.message : String(e)}`);
      }
      return { success: true, attempts: attempt, home_used: attachedHome };
    }

    return {
      success: false,
      attempts: maxRetries,
      error:
        `Conversation stayed GuestPoints: no reciprocal leg was created server-side after the message. ` +
        `This usually means the offered home (${senderHomeId}) was not eligible for a reciprocal exchange on these dates ` +
        `(e.g. home not verified, or calendar not open as RECIPROCAL). Verify the home and check its calendar, then retry.`,
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

  /** Archive a conversation. */
  async archiveConversation(conversationId: number): Promise<unknown> {
    return this.patch(
      `${API_BASE}/v1/conversations/${conversationId}/archive`,
      "api",
      {}
    );
  }

  /** Unarchive a conversation. */
  async unarchiveConversation(conversationId: number): Promise<unknown> {
    return this.patch(
      `${API_BASE}/v1/conversations/${conversationId}/unarchive`,
      "api",
      {}
    );
  }

  /** Mark a conversation as favorite. */
  async favoriteConversation(conversationId: number): Promise<unknown> {
    return this.post(
      `${API_BASE}/v1/conversations/${conversationId}/favorite`,
      "api",
      {}
    );
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
    return this.post(
      `${BFF_BASE}/exchange/${conversationId}/pre-approve`,
      "bff",
      {}
    );
  }

  /**
   * Switch an exchange to reciprocal.
   * Endpoint: PATCH https://bff.homeexchange.com/exchange/{conversationId}/change-to-reciprocal/{senderHomeId}
   *
   * The BFF only accepts {senderHomeId} when it is the home already attached to
   * my side of this conversation (set at first contact). Passing any other home —
   * or calling on a pure GuestPoints conversation with no home leg — returns a
   * generic HTTP 500. We therefore auto-derive the attached home and ignore a
   * mismatching caller-provided value. `senderHomeId` is now an optional hint:
   * it is only used as a fallback when no home of mine is attached yet.
   */
  async changeExchangeToReciprocal(
    conversationId: number,
    senderHomeId?: number
  ): Promise<unknown> {
    const attachedHome = await this.resolveAttachedHome(conversationId);

    if (attachedHome === null) {
      if (senderHomeId === undefined) {
        throw new Error(
          `No home of yours is attached to conversation ${conversationId} ` +
            `(pure GuestPoints conversation). Cannot convert to reciprocal: ` +
            `this endpoint can only confirm a home already paired in the conversation. ` +
            `Provide senderHomeId explicitly to attempt creating a reciprocal leg.`
        );
      }
      // No attached leg: best-effort attempt with the caller-provided home.
      const result = await this.patch<unknown>(
        `${BFF_BASE}/exchange/${conversationId}/change-to-reciprocal/${senderHomeId}`,
        "bff"
      );
      return { result, home_used: senderHomeId, attached_home: null };
    }

    const homeOverridden =
      senderHomeId !== undefined && senderHomeId !== attachedHome;
    const result = await this.patch<unknown>(
      `${BFF_BASE}/exchange/${conversationId}/change-to-reciprocal/${attachedHome}`,
      "bff"
    );
    return {
      result,
      home_used: attachedHome,
      ...(homeOverridden
        ? {
            note: `Ignored provided senderHomeId=${senderHomeId}; used home ${attachedHome} attached to this conversation.`,
          }
        : {}),
    };
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
    return this.post(
      `${API_BASE}/v1/exchanges/${conversationId}/cancel`,
      "api",
      { reason }
    );
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
    // Rate limiting
    await this.rateLimit();

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

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < this.requestDelay) {
      await sleep(this.requestDelay - elapsed);
    }
    this.lastRequestAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
