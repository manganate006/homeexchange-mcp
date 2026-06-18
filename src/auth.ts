import type { AuthTokens } from "./types.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
const BFF_REFRESH_URL = "https://bff.homeexchange.com/authentication/refresh";
const TOKEN_CACHE_FILE = join(homedir(), ".homeexchange-mcp-tokens.json");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export class HomeExchangeAuth {
  private tokens: AuthTokens | null = null;

  constructor() { this.loadTokens(); }

  async ensureAuthenticated(): Promise<void> {
    const now = new Date();
    if (this.tokens && this.tokens.expiresAt > now) {
      const remainingMs = this.tokens.expiresAt.getTime() - now.getTime();
      if (remainingMs < 2 * 3_600_000 && this.tokens.sessionCookie) {
        console.error(`[auth] Token expires in ${Math.round(remainingMs / 60_000)}min \u2014 proactively refreshing...`);
        await this.tryRefresh();
      }
      return;
    }
    this.loadTokens();
    if (!this.tokens || this.tokens.expiresAt <= now) {
      const refreshed = await this.tryRefresh();
      if (refreshed) return;
      const hasSession = !!this.tokens?.sessionCookie;
      const sessionInfo = hasSession
        ? "PHPSESSID was stored but the server session has expired.\n\n"
        : "No session cookies stored \u2014 auto-renewal was not available.\n\n";
      throw new Error(
        "\u26a0\ufe0f Token expired \u2014 re-authentication required.\n\n" + sessionInfo +
        "To fix:\n1. Open https://www.homeexchange.fr in your browser (must be logged in)\n" +
        "2. DevTools (F12) \u2192 Application \u2192 Cookies \u2192 homeexchange.fr\n" +
        "3. Copy ALL cookies: oidc_access_token + refresh_token + PHPSESSID\n" +
        "4. Call he_set_cookies with the full cookie string\n\n" +
        "\ud83d\udca1 The refresh_token cookie is httpOnly \u2014 it's only visible in the DevTools Cookies panel, not via document.cookie.\n" +
        "\ud83d\udca1 Set up the keep-alive cron (bin/keep-alive.sh) to prevent session expiration."
      );
    }
  }

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
        ? "Token expired \u2014 auto-refresh will be attempted on next API call"
        : "Token expired \u2014 re-inject cookies from browser (DevTools \u2192 Cookies \u2192 homeexchange.fr)";
    } else if (remainingHours <= 2) {
      warning = `Token expires in ${remainingHours}h` + (hasSessionCookie
        ? " \u2014 auto-refresh available" : " \u2014 inject cookies with refresh_token via he_set_cookies");
    }
    return { authenticated, expiresAt: expiresAt?.toISOString(), remainingHours: authenticated ? remainingHours : 0, tokenSource: this.tokens?.source, hasSessionCookie, autoRenewEnabled: hasSessionCookie, ...(warning ? { warning } : {}) };
  }

  invalidate(): void {
    if (this.tokens) this.tokens = { ...this.tokens, expiresAt: new Date(0) };
    console.error("[auth] Tokens invalidated");
  }

  setTokens(accessToken: string, refreshToken?: string): void {
    this.tokens = { accessToken, refreshToken: refreshToken || "", expiresAt: new Date(Date.now() + TOKEN_TTL_MS), userAgent: USER_AGENT, source: "manual" };
    this.saveTokensToCache();
    console.error("[auth] Tokens set manually, expires at", this.tokens.expiresAt.toISOString());
  }

  setCookies(cookieString: string): void {
    const map = this.parseCookieMap(cookieString);
    const accessToken = map["oidc_access_token"] || map["access_token"];
    if (!accessToken) {
      throw new Error("No oidc_access_token or access_token found in cookies.\nInclude: oidc_access_token, refresh_token, PHPSESSID (all needed for auto-renewal).");
    }
    const refreshCookies: string[] = [];
    for (const name of ["PHPSESSID", "refresh_token", "id_token", "oidc_access_token"]) {
      if (map[name]) refreshCookies.push(`${name}=${map[name]}`);
    }
    const sessionCookie = refreshCookies.length > 0 ? refreshCookies.join("; ") : undefined;
    this.tokens = { accessToken, refreshToken: map["refresh_token"] || "", expiresAt: new Date(Date.now() + TOKEN_TTL_MS), userAgent: USER_AGENT, source: "cookies", sessionCookie };
    this.saveTokensToCache();
    const parts: string[] = [];
    if (map["PHPSESSID"]) parts.push("PHPSESSID");
    if (map["refresh_token"]) parts.push("refresh_token");
    const info = parts.length > 0 ? ` (${parts.join(" + ")} stored \u2014 auto-renewal enabled)` : " (manual renewal only)";
    console.error("[auth] Tokens extracted from cookies" + info);
  }

  async tryRefresh(): Promise<boolean> {
    const sessionCookie = this.tokens?.sessionCookie;
    if (!sessionCookie) return false;
    try {
      console.error("[auth] Attempting auto-refresh with stored cookies...");
      const res = await fetch(BFF_REFRESH_URL, {
        method: "GET",
        headers: { Cookie: sessionCookie, "user-agent": USER_AGENT, Referer: "https://www.homeexchange.fr/", accept: "application/json, text/plain, */*", "accept-language": "fr" },
        redirect: "manual", signal: AbortSignal.timeout(15_000),
      });
      if (res.status !== 200) { console.error(`[auth] Refresh returned HTTP ${res.status}`); return false; }
      const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
      const setCookieHeaders: string[] = typeof getSetCookie === "function" ? getSetCookie.call(res.headers) : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/).filter(Boolean);
      let newAccessToken: string | undefined;
      const newCookieParts: string[] = [];
      for (const sc of setCookieHeaders) {
        const cookiePart = sc.split(";")[0].trim();
        const name = cookiePart.split("=")[0];
        if (name === "oidc_access_token") newAccessToken = cookiePart.split("=").slice(1).join("=");
        if (["oidc_access_token", "refresh_token", "PHPSESSID", "id_token"].includes(name)) newCookieParts.push(cookiePart);
      }
      if (!newAccessToken) { console.error("[auth] Refresh: no oidc_access_token in response"); return false; }
      const oldMap = this.parseCookieMap(sessionCookie);
      for (const part of newCookieParts) { const eq = part.indexOf("="); if (eq > 0) oldMap[part.substring(0, eq)] = part.substring(eq + 1); }
      const updatedSessionCookie = Object.entries(oldMap).map(([k, v]) => `${k}=${v}`).join("; ");
      this.tokens = { ...this.tokens!, accessToken: newAccessToken, refreshToken: oldMap["refresh_token"] || this.tokens!.refreshToken, expiresAt: new Date(Date.now() + TOKEN_TTL_MS), source: "refresh", sessionCookie: updatedSessionCookie };
      this.saveTokensToCache();
      console.error("[auth] Token refreshed successfully, expires at", this.tokens.expiresAt.toISOString());
      return true;
    } catch (e) { console.error("[auth] Refresh error:", (e as Error).message); return false; }
  }

  getHeaders(server: "bff" | "api"): Record<string, string> {
    if (!this.tokens) throw new Error("Not authenticated");
    return { accept: "application/json, text/plain, */*", "accept-language": "fr", authorization: `Bearer ${this.tokens.accessToken}`, refresh_token: this.tokens.refreshToken, he_web_version: process.env.HE_WEB_VERSION || "19.7.2", "cache-control": "no-cache", pragma: "no-cache", "user-agent": USER_AGENT, Referer: "https://www.homeexchange.fr/", "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"', "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"', "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site" };
  }

  getWriteHeaders(server: "bff" | "api"): Record<string, string> { return { ...this.getHeaders(server), "content-type": "application/json" }; }

  getWebApiHeaders(): Record<string, string> {
    if (!this.tokens) throw new Error("Not authenticated");
    return { accept: "application/json, text/plain, */*", "accept-language": "fr", cookie: `access_token=${this.tokens.accessToken}; refresh_token=${this.tokens.refreshToken}`, "user-agent": USER_AGENT, Referer: "https://www.homeexchange.fr/", "x-requested-with": "XMLHttpRequest" };
  }

  private loadTokens(): void {
    const envToken = process.env.HE_ACCESS_TOKEN;
    if (envToken) { this.tokens = { accessToken: envToken, refreshToken: process.env.HE_REFRESH_TOKEN || "", expiresAt: new Date(Date.now() + TOKEN_TTL_MS), userAgent: USER_AGENT, source: "env" }; console.error("[auth] Using HE_ACCESS_TOKEN"); return; }
    const envCookies = process.env.HE_COOKIES;
    if (envCookies) { try { this.setCookies(envCookies); return; } catch (e) { console.error("[auth] Failed to parse HE_COOKIES:", (e as Error).message); } }
    if (existsSync(TOKEN_CACHE_FILE)) {
      try {
        const data = JSON.parse(readFileSync(TOKEN_CACHE_FILE, "utf-8"));
        if (data.accessToken) {
          const expiresAt = new Date(data.expiresAt);
          const valid = expiresAt > new Date();
          this.tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken || "", expiresAt, userAgent: USER_AGENT, source: valid ? "cache" : "cache-expired", sessionCookie: data.sessionCookie };
          if (valid) console.error("[auth] Using cached tokens");
          else console.error("[auth] Cached tokens expired" + (data.sessionCookie ? " \u2014 will attempt auto-refresh" : ""));
        }
      } catch { console.error("[auth] Failed to read token cache"); }
    }
  }

  private saveTokensToCache(): void {
    if (!this.tokens) return;
    try {
      const payload: Record<string, unknown> = { accessToken: this.tokens.accessToken, refreshToken: this.tokens.refreshToken, expiresAt: this.tokens.expiresAt.toISOString() };
      if (this.tokens.sessionCookie) payload.sessionCookie = this.tokens.sessionCookie;
      writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(payload, null, 2));
    } catch { console.error("[auth] Failed to write token cache"); }
  }

  private parseCookieMap(cookieString: string): Record<string, string> {
    const map: Record<string, string> = {};
    for (const part of cookieString.split(";")) { const t = part.trim(); const eq = t.indexOf("="); if (eq >= 0) map[t.slice(0, eq)] = t.slice(eq + 1); }
    return map;
  }
}
