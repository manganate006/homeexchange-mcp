#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HomeExchangeAuth } from "./auth.js";
import { HomeExchangeApi } from "./api.js";
import { createServer } from "./server.js";

async function main() {
  // Auth0 + Cloudflare Turnstile means we can't auto-login.
  // Tokens must be provided via env vars or he_set_tokens tool.
  const hasTokens = process.env.HE_ACCESS_TOKEN || process.env.HE_COOKIES;
  if (!hasTokens) {
    console.error(
      "[homeexchange-mcp] Warning: No HE_ACCESS_TOKEN or HE_COOKIES set.\n" +
        "Use the he_set_tokens or he_set_cookies tool to inject auth after startup,\n" +
        "or set HE_ACCESS_TOKEN in your .mcp.json env."
    );
  }

  const readDelay = parseInt(process.env.HE_READ_DELAY || "500", 10);
  const writeDelay = parseInt(process.env.HE_WRITE_DELAY || "2000", 10);
  const messageDelay = parseInt(process.env.HE_MESSAGE_DELAY || "60000", 10);
  // Legacy: HE_REQUEST_DELAY sets both read/write if the new vars aren't set
  const legacyDelay = process.env.HE_REQUEST_DELAY ? parseInt(process.env.HE_REQUEST_DELAY, 10) : null;

  const auth = new HomeExchangeAuth();
  const api = new HomeExchangeApi(auth, legacyDelay ?? readDelay, legacyDelay ?? writeDelay, messageDelay);
  const server = createServer(auth, api);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[homeexchange-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[homeexchange-mcp] Fatal error:", err);
  process.exit(1);
});
