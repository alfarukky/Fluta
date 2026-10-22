import "server-only";

import { CLIENT_IP_HEADER } from "@/lib/client-ip";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

import { getAuth } from "./auth";

export type PasswordCheck = "OK" | "WRONG" | "RATE_LIMITED" | "FAILED";

// Checks the signed-in user's password again, for actions that need it
// (changing the bank account for online payments). Better Auth's
// /verify-password checks it against that user's own credential account and
// starts no new session.
//
// It goes through Better Auth's HTTP handler, not auth.api: rate limits only
// apply to HTTP requests, and /verify-password has the same limit as sign-in
// (src/server/auth/auth.ts), keyed by the same client IP header. The request
// carries the caller's session cookie and IP, and Better Auth's own origin.
export async function checkOwnPassword(requestHeaders: Headers, password: string): Promise<PasswordCheck> {
  const origin = getServerEnv().BETTER_AUTH_URL;
  const headers = new Headers({ "content-type": "application/json", origin });
  const cookie = requestHeaders.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const ip = requestHeaders.get(CLIENT_IP_HEADER);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);

  let response: Response;
  try {
    response = await getAuth().handler(
      new Request(`${origin}/api/auth/verify-password`, { method: "POST", headers, body: JSON.stringify({ password }) }),
    );
  } catch (error) {
    logger.error("[auth] checking a password failed:", error instanceof Error ? error.name : "unknown error");
    return "FAILED";
  }

  if (response.ok) return "OK";
  if (response.status === 400) return "WRONG";
  if (response.status === 429) return "RATE_LIMITED";
  logger.error(`[auth] checking a password failed with HTTP ${response.status}`);
  return "FAILED";
}
