import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { getPrisma } from "@/server/data/client";
import { getServerEnv } from "@/lib/env";

const SIGN_IN_WINDOW_SECONDS = 5 * 60;
const SIGN_IN_MAX_ATTEMPTS = 10;

// Authentication only: who the user is. Store membership, roles, and store
// access are Fluta's own checks (src/server/auth/access.ts).
function createAuth() {
  const env = getServerEnv();
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
    emailAndPassword: { enabled: true, disableSignUp: true },
    // No Better Auth endpoint may create a user: sign-up is disabled, its path
    // is removed, and the hook below rejects any creation that slips through.
    // Users are created only by createUserWithPassword (src/server/data/users.ts).
    disabledPaths: ["/sign-up/email"],
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            throw new APIError("FORBIDDEN", { message: "Accounts are created by invitation only." });
          },
        },
      },
    },
    // Rate limits apply to HTTP requests to /api/auth/*, not to direct
    // auth.api calls, so the sign-in form must post to the endpoint.
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: SIGN_IN_WINDOW_SECONDS, max: SIGN_IN_MAX_ATTEMPTS },
      },
    },
    advanced: {
      // The client IP for rate limiting, as set by the hosting proxy (Railway
      // sets X-Real-IP; confirm at deployment). Without it, every client would
      // share the proxy's address and one rate-limit bucket.
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    // Must be last: lets server actions (sign-out) set and clear cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let auth: Auth | undefined;

// Created on first use, like the Prisma client, so `next build` needs no secrets.
export function getAuth(): Auth {
  auth ??= createAuth();
  return auth;
}
