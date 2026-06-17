import type { AuthTokens } from "./types.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23h
const BFF_REFRESH_URL = "https://bff.homeexchange.com/authentication/refresh";
const TOKEN_CACHE_FILE = join(homedir(), ".homeexchange-mcp-tokens.json");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/**
 * HomeExchange authentication manager.
 *
 * Supports multiple auth modes:
 * 1. HE_ACCESS_TOKEN + HE_REFRESH_TOKEN env vars (direct tokens)
 * 2. HE_COOKIES env var (raw cookie string from browser, include PHPSESSID for auto-refresh)
 * 3. Cached tokens from ~/.homeexchange-mcp-tokens.json
 *
 * Auth0 (auth.homeexchange.com) requires a real browser with Cloudflare Turnstile,
 * so automated email/password login is NOT supported.
 */
export class HomeExchangeAuth {
  private tokens: AuthTokens | null = null;

  constructor() {
    this.loadTokens();
  }

  /** Ensure we have valid tokens. Tries auto-refresh via PHPSESSID before throwing. */
  async ensureAuthenticated(): Promise<void> {
    if (this.tokens && this.tokens.expiresAt > new Date()) {
      return;
    }

    // Try to reload from env/cache
    this.loadTokens();

    if (!this.tokens || this.tokens.expiresAt <= new Date()) {
      // Try auto-refresh using stored session cookie (PHPSESSID)
      const refreshed = await this.tryRefresh();
      if (!refreshed) {
        throw new Error(
          "Not authenticated. HomeExchange uses Auth0 with Cloudflare Turnstile — automated login is not possible.\n\n" +
            "To authenticate:\n" +
            "1. Login at https://www.homeexchange.fr in your browser\n" +
            "2. Open DevTools → Application → Cookies → homeexchange.fr\n" +
            "3. Copy the 'oidc_access_token' cookie value\n" +
            "4. Set HE_ACCESS_TOKEN in your .mcp.json env\n\n" +
            "Or set HE_COOKIES with the full cookie string (including PHPSESSID) for automatic renewal.\n" +
            "Or use he_set_tokens / he_set_cookies tools to inject at runtime."
        );
      }
    }
  }

  /** Get auth status without triggering login. */
  getStatus(): {
    authenticated: boolean;
    expiresAt?: string;
    tokenSource?: string;
  } {
    return {
      authenticated: !!this.tokens && this.tokens.expiresAt > new Date(),
      expiresAt: this.tokens?.expiresAt.toISOString(),
      tokenSource: this.tokens?.source,
    };
  }

  /** Invalidate cached tokens (e.g. after 401). Preserves sessionCookie for auto-refresh. */
  invalidate(): void {
    if (this.tokens) {
      // Mark as expired but keep sessionCookie so tryRefresh() can still run
      this.tokens = { ...this.tokens, expiresAt: new Date(0) };
    }
    console.error("[auth] Tokens invalidated");
  }

  /** Inject tokens at runtime (from he_set_tokens tool). */
  setTokens(accessToken: string, refreshToken?: string): void {
    this.tokens = {
      accessToken,
      refreshToken: refreshToken || "",
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      userAgent: USER_AGENT,
      source: "manual",
    };
    this.saveTokensToCache();
    console.error("[auth] Tokens set manually, expires at", this.tokens.expiresAt.toISOString());
  }

  /** Inject cookies string at runtime and extract tokens. Stores PHPSESSID for auto-refresh. */
  setCookies(cookieString: string): void {
    const map = this.parseCookieMap(cookieString);
    // oidc_access_token is the current cookie name; access_token is the legacy fallback
    const accessToken = map["oidc_access_token"] || map["access_token"];
    if (!accessToken) {
      throw new Error(
        "No oidc_access_token or access_token found in cookies.\n" +
          "Tip: copy all cookies from DevTools → Application → Cookies → homeexchange.fr (including PHPSESSID for auto-renewal)."
      );
    }
    const phpSessId = map["PHPSESSID"];
    this.tokens = {
      accessToken,
      refreshToken: map["refresh_token"] || "",
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      userAgent: USER_AGENT,
      source: "cookies",
      sessionCookie: phpSessId ? `PHPSESSID=${phpSessId}` : undefined,
    };
    this.saveTokensToCache();
    const refreshInfo = phpSessId ? " (PHPSESSID stored — auto-renewal enabled)" : " (no PHPSESSID — manual renewal only)";
    console.error("[auth] Tokens extracted from cookies" + refreshInfo + ", expires at", this.tokens.expiresAt.toISOString());
  }

  /**
   * Attempt to renew the access token using the stored PHPSESSID session cookie.
   * Calls GET https://bff.homeexchange.com/authentication/refresh which returns
   * a new oidc_access_token via Set-Cookie header (server uses its stored refresh_token).
   * Returns true on success, false if refresh is not possible or fails.
   */
  async tryRefresh(): Promise<boolean> {
    const sessionCookie = this.tokens?.sessionCookie;
    if (!sessionCookie) return false;

    try {
      console.error("[auth] Attempting auto-refresh via PHPSESSID...");
      const res = await fetch(BFF_REFRESH_URL, {
        method: "GET",
        headers: {
          Cookie: sessionCookie,
          "user-agent": USER_AGENT,
          Referer: "https://www.homeexchange.fr/",
          accept: "application/json, text/plain, */*",
          "accept-language": "fr",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status !== 200) {
        console.error(`[auth] Refresh endpoint returned HTTP ${res.status} — session may have expired`);
        return false;
      }

      // Parse Set-Cookie headers for new oidc_access_token
      const setCookies: string[] = typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [res.headers.get("set-cookie") ?? ""].filter(Boolean);

      let newAccessToken: string | undefined;
      for (const setCookie of setCookies) {
        const match = setCookie.match(/(?:^|;\s*)oidc_access_token=([^;]+)/);
        if (match) {
          newAccessToken = match[1];
          break;
        }
      }

      if (!newAccessToken) {
        console.error("[auth] Refresh: no oidc_access_token in Set-Cookie response");
        return false;
      }

      this.tokens = {
        ...this.tokens!,
        accessToken: newAccessToken,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        source: "refresh",
      };
      this.saveTokensToCache();
      console.error("[auth] Token auto-refreshed successfully, expires at", this.tokens.expiresAt.toISOString());
      return true;
    } catch (e) {
      console.error("[auth] Refresh error:", (e as Error).message);
      return false;
    }
  }

  /** Build headers for an API request to BFF/API. */
  getHeaders(server: "bff" | "api"): Record<string, string> {
    if (!this.tokens) throw new Error("Not authenticated");

    return {
      accept: "application/json, text/plain, */*",
      "accept-language": "fr",
      authorization: `Bearer ${this.tokens.accessToken}`,
      refresh_token: this.tokens.refreshToken,
      he_web_version: process.env.HE_WEB_VERSION || "19.7.2",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": USER_AGENT,
      Referer: "https://www.homeexchange.fr/",
      "sec-ch-ua":
        '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "cross-site",
    };
  }

  /** Build headers for write (POST/PUT/PATCH) requests. */
  getWriteHeaders(server: "bff" | "api"): Record<string, string> {
    return {
      ...this.getHeaders(server),
      "content-type": "application/json",
    };
  }

  /** Build headers for www.homeexchange.fr/api/ requests (cookie-based). */
  getWebApiHeaders(): Record<string, string> {
    if (!this.tokens) throw new Error("Not authenticated");

    return {
      accept: "application/json, text/plain, */*",
      "accept-language": "fr",
      cookie: `access_token=${this.tokens.accessToken}; refresh_token=${this.tokens.refreshToken}`,
      "user-agent": USER_AGENT,
      Referer: "https://www.homeexchange.fr/",
      "x-requested-with": "XMLHttpRequest",
    };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private loadTokens(): void {
    // Priority 1: Direct token env vars
    const envToken = process.env.HE_ACCESS_TOKEN;
    if (envToken) {
      this.tokens = {
        accessToken: envToken,
        refreshToken: process.env.HE_REFRESH_TOKEN || "",
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        userAgent: USER_AGENT,
        source: "env",
      };
      console.error("[auth] Using access_token from HE_ACCESS_TOKEN env var");
      return;
    }

    // Priority 2: Cookie string env var
    const envCookies = process.env.HE_COOKIES;
    if (envCookies) {
      try {
        this.setCookies(envCookies);
        return;
      } catch (e) {
        console.error("[auth] Failed to parse HE_COOKIES:", (e as Error).message);
      }
    }

    // Priority 3: Cached tokens from disk
    if (existsSync(TOKEN_CACHE_FILE)) {
      try {
        const data = JSON.parse(readFileSync(TOKEN_CACHE_FILE, "utf-8"));
        if (data.accessToken) {
          const expiresAt = new Date(data.expiresAt);
          const valid = expiresAt > new Date();
          this.tokens = {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken || "",
            expiresAt,
            userAgent: USER_AGENT,
            source: valid ? "cache" : "cache-expired",
            sessionCookie: data.sessionCookie,
          };
          if (valid) {
            console.error("[auth] Using cached tokens from", TOKEN_CACHE_FILE);
          } else {
            const canRefresh = !!data.sessionCookie;
            console.error(
              "[auth] Cached tokens expired" + (canRefresh ? " — will attempt auto-refresh" : "")
            );
          }
        }
      } catch {
        console.error("[auth] Failed to read token cache");
      }
    }
  }

  private saveTokensToCache(): void {
    if (!this.tokens) return;
    try {
      const payload: Record<string, unknown> = {
        accessToken: this.tokens.accessToken,
        refreshToken: this.tokens.refreshToken,
        expiresAt: this.tokens.expiresAt.toISOString(),
      };
      if (this.tokens.sessionCookie) {
        payload.sessionCookie = this.tokens.sessionCookie;
      }
      writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(payload, null, 2));
      console.error("[auth] Tokens cached to", TOKEN_CACHE_FILE);
    } catch {
      console.error("[auth] Failed to write token cache");
    }
  }

  private parseCookieMap(cookieString: string): Record<string, string> {
    const map: Record<string, string> = {};
    for (const part of cookieString.split(";")) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      map[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return map;
  }
}
