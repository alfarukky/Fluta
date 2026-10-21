import type { NextConfig } from "next";

import { readR2PublicUrl } from "./src/lib/env";

// Store logos live in R2 and are served from its public address. Builds work
// without the variable (no secrets in CI); the pattern is then just omitted.
const r2PublicUrl = readR2PublicUrl();

// Pages whose URL carries a secret token (staff invitations, password
// resets, order tracking links): never cached, never indexed, and never sent
// on as a referrer. Server Actions post to the page's own URL, so a tracking
// page's actions get the same headers.
export const PRIVATE_LINK_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

export const PRIVATE_LINK_SOURCES = [
  "/invite/:token",
  "/reset-password",
  "/api/auth/reset-password/:token",
  "/o/:token/:path*",
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: r2PublicUrl ? [new URL(`${r2PublicUrl.origin}/**`)] : [],
  },
  async headers() {
    return PRIVATE_LINK_SOURCES.map((source) => ({
      source,
      headers: PRIVATE_LINK_HEADERS,
    }));
  },
  // Development request logs would print token URLs; leave those requests out
  // (the tracking link's /o/{token} too).
  // Paystack retries webhooks often; their URL carries no secret, but there's
  // no reason to log every attempt.
  // Server Action calls are logged with their arguments, which carry customer
  // phone numbers and addresses (order entry); leave them out too.
  logging: {
    incomingRequests: { ignore: [/\/invite\//, /\/reset-password/, /\/o\//, /\/api\/webhooks\//] },
    serverFunctions: false,
  },
};

export default nextConfig;
