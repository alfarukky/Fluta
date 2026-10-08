import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { getServerEnv } from "@/lib/env";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/schemas/users";
import { findActiveMemberships } from "@/server/data/access";
import { getPrisma } from "@/server/data/client";
import { buildPasswordResetEmail, RESET_LINK_VALID_MINUTES, trySendEmail } from "@/server/services/emails";

const SIGN_IN_WINDOW_SECONDS = 5 * 60;
const SIGN_IN_MAX_ATTEMPTS = 10;
const PASSWORD_RESET_WINDOW_SECONDS = 15 * 60;
const PASSWORD_RESET_REQUEST_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_MAX_ATTEMPTS = 10;

// Authentication only: who the user is. Store membership, roles, and store
// access are Fluta's own checks (src/server/auth/access.ts).
function createAuth() {
  const env = getServerEnv();
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // Forgot password: Better Auth's own flow, sending through Fluta's mailer.
      // Set explicitly rather than left to the default.
      resetPasswordTokenExpiresIn: RESET_LINK_VALID_MINUTES * 60,
      // A reset signs the account out everywhere.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // Not awaited, so the response takes as long whether or not the
        // email has an account (Better Auth only calls this when it does).
        void sendPasswordResetEmail(user, url);
      },
    },
    // No Better Auth endpoint may create a user: sign-up is disabled, its path
    // is removed, and the hook below rejects any creation that slips through.
    // Users are created only by createUserWithPassword (src/server/data/users.ts).
    disabledPaths: ["/sign-up/email"],
    // Reset tokens (and any other verification values) are stored as hashes,
    // never raw, like Fluta's own invite and tracking tokens.
    verification: { storeIdentifier: "hashed" },
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
        "/request-password-reset": { window: PASSWORD_RESET_WINDOW_SECONDS, max: PASSWORD_RESET_REQUEST_MAX_ATTEMPTS },
        "/reset-password": { window: PASSWORD_RESET_WINDOW_SECONDS, max: PASSWORD_RESET_MAX_ATTEMPTS },
        // The emailed link (GET /reset-password/<token>) only checks the token
        // and redirects. The limiter keys rows by path, which would store the
        // raw token in RateLimit, so this path isn't limited (guessing a
        // random 24-character token isn't feasible; setting the password,
        // above, is limited).
        "/reset-password/*": false,
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

// The email starts with the person's store name when they have one.
async function sendPasswordResetEmail(user: { id: string; email: string }, url: string): Promise<void> {
  try {
    const [membership] = await findActiveMemberships(user.id);
    await trySendEmail(buildPasswordResetEmail({ to: user.email, storeName: membership?.store.name ?? null, url }), "password reset");
  } catch (error) {
    console.error("[auth] preparing the password reset email failed:", error instanceof Error ? error.name : "unknown error");
  }
}

export type Auth = ReturnType<typeof createAuth>;

let auth: Auth | undefined;

// Created on first use, like the Prisma client, so `next build` needs no secrets.
export function getAuth(): Auth {
  auth ??= createAuth();
  return auth;
}
