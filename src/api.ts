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

  constructor(auth: HomeExchangeAuth, requestDelay = 1500) {
    this.auth = auth;
    this.requestDelay = requestDelay;
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

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

  /** Get conversations list. */
  async getConversations(
    filter: "ALL" | "UNREAD" = "ALL",
    first = 10,
    after = 0
  ): Promise<ConversationsResponse> {
    const params = new URLSearchParams({
      filter,
      first: String(first),
      after: String(after),
    });
    return this.get(
      `${API_BASE}/v3/conversations/me?${params}`,
      "api"
    );
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

  // ─── Read (Homes) ──────────────────────────────────────────────────────────

  /** Get authenticated user's homes. */
  async getMyHomes(): Promise<unknown> {
    return this.get(`${API_BASE}/v1/homes/me`, "api");
  }

  // ─── Read (Exchanges) ─────────────────────────────────────────────────────────

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

  // ─── Read (Conversations enriched) ───────────────────────────────────────────

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

  // ─── Read (Search) ───────────────────────────────────────────────────────────

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
      const admins = home.translated_admins as unknown[] | undefined;

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
        translated_admins: admins?.slice(0, 3),
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

  // ─── Read (Subscription) ───────────────────────────────────────────────────────

  /** Get subscription info. */
  async getSubscription(): Promise<unknown> {
    return this.get(`${API_BASE}/v1/subscription`, "api");
  }

  // ─── Read (Favorites enriched) ───────────────────────────────────────────────

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

  // ─── Write (Batch) ────────────────────────────────────────────────────────

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

  // ─── Write ────────────────────────────────────────────────────────────────────

  async sendMessage(conversationId: number, content: string): Promise<unknown> {
    return this.post(`${API_BASE}/v1/messages`, "api", {
      conversation: conversationId,
      content,
    });
  }

  async sendFirstMessage(
    receiverId: number,
    homeId: number,
    content: string,
    startOn: string,
    endOn: string,
    nbGuest: number,
    exchangeType?: number
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
    return this.post(`${API_BASE}/v1/messages`, "api", body);
  }

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

  async updateHome(homeId: number, fields: Record<string, unknown>): Promise<unknown> {
    return this.patch(`${BFF_BASE}/v1/homes/${homeId}`, "bff", fields);
  }

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

  // ─── Write (Favorites) ──────────────────────────────────────────────────────

  async addFavorite(homeId: number, wishlistId?: number): Promise<unknown> {
    const body: Record<string, unknown> = { home_id: homeId };
    if (wishlistId) body.wishlist_id = wishlistId;
    return this.post(`${BFF_BASE}/favorites`, "bff", body);
  }

  async removeFavorite(homeId: number): Promise<unknown> {
    return this.del(`${BFF_BASE}/favorites/${homeId}`, "bff");
  }

  // ─── Write (Conversations) ──────────────────────────────────────────────────

  async archiveConversation(conversationId: number): Promise<unknown> {
    return this.put(
      `${API_BASE}/v1/conversations/${conversationId}/archive`,
      "api",
      {}
    );
  }

  async unarchiveConversation(conversationId: number): Promise<unknown> {
    return this.put(
      `${API_BASE}/v1/conversations/${conversationId}/unarchive`,
      "api",
      {}
    );
  }

  // ─── Write (Exchanges) ─────────────────────────────────────────────────────

  async preApproveExchange(conversationId: number): Promise<unknown> {
    return this.post(
      `${BFF_BASE}/exchange/${conversationId}/pre-approve`,
      "bff",
      {}
    );
  }

  async cancelExchange(conversationId: number, reason: string): Promise<unknown> {
    return this.post(
      `${API_BASE}/v1/exchanges/${conversationId}/cancel`,
      "api",
      { reason }
    );
  }

  // ─── Write (Ratings) ──────────────────────────────────────────────────────

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

  // ─── HTTP helpers ────────────────────────────────────────────────────────────────

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

  private async put<T>(url: string, server: "bff" | "api", body: unknown): Promise<T> {
    return this.request("PUT", url, server, body);
  }

  private async del<T>(url: string, server: "bff" | "api"): Promise<T> {
    return this.request("DELETE", url, server);
  }

  private async patch<T>(url: string, server: "bff" | "api", body: unknown): Promise<T> {
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
    await this.rateLimit();
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

    // Handle 401 — invalidate and retry once (tryRefresh runs inside ensureAuthenticated)
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
