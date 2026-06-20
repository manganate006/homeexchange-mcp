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
 * 2. HE_COOKIES env var (raw cookie string from browser)
 * 3. Cached tokens from ~/.homeexchange-mcp-tokens.json
 *
 * Auth0 (auth.homeexchange.com) requires a real browser with Cloudflare Turnstile,
 * so automated email/password login is NOT supported. Instead:
 * - Login manually in your browser
 * - Extract access_token from cookies (DevTools → Application → Cookies)
 * - Set HE_ACCESS_TOKEN env var
 */
export class HomeExchangeAuth {
  private tokens: AuthTokens | null = null;

  constructor() {
    this.loadTokens();
  }

  /** Ensure we have valid tokens. Tries auto-refresh via PHPSESSID before throwing. */
  async ensureAuthenticated(): Promise<void> {
    const now = new Date();

    if (this.tokens && this.tokens.expiresAt > now) {
      // Proactive refresh: if < 2h remaining and we have PHPSESSID, refresh now
      const remainingMs = this.tokens.expiresAt.getTime() - now.getTime();
      if (remainingMs < 2 * 3_600_000 && this.tokens.sessionCookie) {
        console.error(`[auth] Token expires in ${Math.round(remainingMs / 60_000)}min — proactively refreshing...`);
        await this.tryRefresh();
      }
      return;
    }

    // Try to reload from env/cache
    this.loadTokens();

    if (!this.tokens || this.tokens.expiresAt <= now) {
      // Try auto-refresh using stored session cookie (PHPSESSID)
      const refreshed = await this.tryRefresh();
      if (refreshed) return;

      // Build a clear error with actionable steps
      const hasSession = !!this.tokens?.sessionCookie;
      const sessionInfo = hasSession
        ? "PHPSESSID was stored but the server session has expired (PHP sessions typically last ~2h of inactivity).\n\n"
        : "No PHPSESSID stored — auto-renewal was not available.\n\n";

      throw new Error(
        "⚠️ Token expired — re-authentication required.\n\n" +
          sessionInfo +
          "To fix:\n" +
          "1. Open https://www.homeexchange.fr in your browser (must be logged in)\n" +
          "2. DevTools (F12) → Application → Cookies → homeexchange.fr\n" +
          "3. Copy ALL cookies: oidc_access_token + PHPSESSID\n" +
          "4. Call he_set_cookies with the full cookie string\n\n" +
          "💡 Tip: include PHPSESSID in your cookies to enable auto-renewal.\n" +
          "💡 Tip: set up the keep-alive cron (see CLAUDE.md) to prevent PHPSESSID expiration."
      );
    }
  }

  /** Get auth status without triggering login. Includes expiry warnings. */
  getStatus(): Record<string, unknown> {
    const now = new Date();
    const authenticated = !!this.tokens && this.tokens.expiresAt > now;
    const expiresAt = this.tokens?.expiresAt;
    const remainingMs = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
    const remainingHours = Math.max(0, Math.round(remainingMs / 3_600_000 * 10) / 10);
    const hasSessionCookie = !!this.tokens?.sessionCookie;

    let warning: string | undefined;
    if (!authenticated) {
      warning = hasSessionCookie
        ? "Token expired — auto-refresh will be attempted on next API call"
        : "Token expired — re-inject a fresh oidc_access_token from the browser (DevTools → Cookies → homeexchange.fr)";
    } else if (remainingHours <= 2) {
      warning = `Token expires in ${remainingHours}h` + (hasSessionCookie
        ? " — auto-refresh via PHPSESSID available"
        : " — no PHPSESSID stored, inject fresh cookies (with PHPSESSID) via he_set_cookies to enable auto-renewal");
    }

    return {
      authenticated,
      expiresAt: expiresAt?.toISOString(),
      remainingHours: authenticated ? remainingHours : 0,
      tokenSource: this.tokens?.source,
      hasSessionCookie,
      autoRenewEnabled: hasSessionCookie,
      ...(warning ? { warning } : {}),
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

  /** Inject cookies string at runtime and extract tokens. Stores all cookies for auto-refresh. */
  setCookies(cookieString: string): { message: string; warning?: string } {
    const map = this.parseCookieMap(cookieString);
    // oidc_access_token is the current cookie name; access_token is the legacy fallback
    const accessToken = map["oidc_access_token"] || map["access_token"];
    if (!accessToken) {
      throw new Error(
        "No oidc_access_token or access_token found in cookies.\n" +
          "Tip: copy all cookies from DevTools → Application → Cookies → homeexchange.fr\n" +
          "Include: oidc_access_token + PHPSESSID (needed for auto-renewal)."
      );
    }
    // Build the session cookie string with all cookies needed for refresh
    // The BFF /authentication/refresh needs PHPSESSID (refresh_token is stored server-side)
    const refreshCookies: string[] = [];
    for (const name of ["PHPSESSID", "refresh_token", "id_token", "oidc_access_token"]) {
      if (map[name]) refreshCookies.push(`${name}=${map[name]}`);
    }
    const sessionCookie = refreshCookies.length > 0 ? refreshCookies.join("; ") : undefined;
    const hasPHPSESSID = !!map["PHPSESSID"];

    this.tokens = {
      accessToken,
      refreshToken: map["refresh_token"] || "",
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      userAgent: USER_AGENT,
      source: "cookies",
      sessionCookie,
    };
    this.saveTokensToCache();

    let message: string;
    let warning: string | undefined;

    if (hasPHPSESSID) {
      message = "Tokens extracted — auto-renewal enabled via PHPSESSID (keep-alive cron will maintain the session)";
    } else {
      message = "Tokens extracted — manual renewal only";
      warning = "PHPSESSID missing! Without it, auto-renewal won't work. " +
        "Copy ALL cookies from DevTools → Application → Cookies → homeexchange.fr (include PHPSESSID).";
    }

    console.error(`[auth] ${message}, expires at`, this.tokens.expiresAt.toISOString());
    return { message, warning };
  }

  /**
   * Attempt to renew the access token using stored cookies (PHPSESSID).
   * Calls GET https://bff.homeexchange.com/authentication/refresh which returns:
   * - JSON body: { accessToken, expiresAt, ... } (same as the web app reads)
   * - Set-Cookie headers: new oidc_access_token, PHPSESSID (for next refresh)
   * The web app sends "x-frontend-client: true" — we replicate this.
   */
  async tryRefresh(): Promise<boolean> {
    const sessionCookie = this.tokens?.sessionCookie;
    if (!sessionCookie) return false;

    try {
      console.error("[auth] Attempting auto-refresh with stored cookies...");
      const res = await fetch(BFF_REFRESH_URL, {
        method: "GET",
        headers: {
          Cookie: sessionCookie,
          "x-frontend-client": "true",
          "user-agent": USER_AGENT,
          Referer: "https://www.homeexchange.fr/",
          accept: "application/json, text/plain, */*",
          "accept-language": "fr",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status !== 200) {
        console.error(`[auth] Refresh returned HTTP ${res.status} — cookies may have expired`);
        return false;
      }

      // Try JSON body first (the web app reads the token from JSON response)
      let newAccessToken: string | undefined;
      let jsonExpiresAt: number | undefined;
      try {
        const body = await res.clone().json();
        if (body?.accessToken) {
          newAccessToken = body.accessToken;
          jsonExpiresAt = body.expiresAt;
          console.error("[auth] Got accessToken from JSON response body");
        }
      } catch {
        // JSON parse failed — fall back to Set-Cookie headers
      }

      // Also parse Set-Cookie headers for PHPSESSID and other cookies needed for next refresh
      const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
      const setCookieHeaders: string[] = typeof getSetCookie === "function"
        ? getSetCookie.call(res.headers)
        : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/).filter(Boolean);

      const newCookieParts: string[] = [];

      for (const sc of setCookieHeaders) {
        const cookiePart = sc.split(";")[0].trim();
        const name = cookiePart.split("=")[0];
        if (!newAccessToken && name === "oidc_access_token") {
          newAccessToken = cookiePart.split("=").slice(1).join("=");
        }
        if (["oidc_access_token", "refresh_token", "PHPSESSID", "id_token"].includes(name)) {
          newCookieParts.push(cookiePart);
        }
      }

      if (!newAccessToken) {
        console.error("[auth] Refresh: no accessToken in JSON body or Set-Cookie headers");
        return false;
      }

      // Merge new cookies into sessionCookie (keep old ones that weren't refreshed)
      const oldMap = this.parseCookieMap(sessionCookie);
      for (const part of newCookieParts) {
        const eq = part.indexOf("=");
        if (eq > 0) oldMap[part.substring(0, eq)] = part.substring(eq + 1);
      }
      const updatedSessionCookie = Object.entries(oldMap).map(([k, v]) => `${k}=${v}`).join("; ");

      this.tokens = {
        ...this.tokens!,
        accessToken: newAccessToken,
        refreshToken: oldMap["refresh_token"] || this.tokens!.refreshToken,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        source: "refresh",
        sessionCookie: updatedSessionCookie,
      };
      this.saveTokensToCache();
      console.error("[auth] Token refreshed successfully, expires at", this.tokens.expiresAt.toISOString());
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
      "x-frontend-client": "true",
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

  // ─── Private ─────────────────────────────────────────────────────────────

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
