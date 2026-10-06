import type { NextConfig } from "next";

import { readR2PublicUrl } from "./src/lib/env";

// Store logos live in R2 and are served from its public address. Builds work
// without the variable (no secrets in CI); the pattern is then just omitted.
const r2PublicUrl = readR2PublicUrl();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: r2PublicUrl ? [new URL(`${r2PublicUrl.origin}/**`)] : [],
  },
};

export default nextConfig;
