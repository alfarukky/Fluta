import type { NextConfig } from "next";

import { readR2PublicUrl } from "./src/lib/env";

// Store logos live in R2 and are served from its public address. Builds work
// without the variable (no secrets in CI); the pattern is then just omitted.
const r2PublicUrl = readR2PublicUrl();

// Pages whose URL carries a secret token (staff invitations, password
// resets): never cached, and never sent on as a referrer.
const PRIVATE_LINK_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: r2PublicUrl ? [new URL(`${r2PublicUrl.origin}/**`)] : [],
  },
  async headers() {
    return ["/invite/:token", "/reset-password", "/api/auth/reset-password/:token"].map((source) => ({
      source,
      headers: PRIVATE_LINK_HEADERS,
    }));
  },
  // Development request logs would print token URLs; leave those requests out.
  logging: {
    incomingRequests: { ignore: [/\/invite\//, /\/reset-password/] },
  },
};

export default nextConfig;
