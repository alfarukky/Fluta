import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { getServerEnv } from "./env";

// The visitor's IP address, as set by the hosting proxy. Railway sets
// X-Real-IP and overwrites whatever the visitor sent (confirm at deployment).
// The only header Fluta trusts for this: Better Auth's rate limits use it too
// (src/server/auth/auth.ts), and X-Forwarded-For, which the visitor can add
// to, is never read.
export const CLIENT_IP_HEADER = "x-real-ip";

// Null when the header is missing or isn't an IP address.
export function getClientIp(headers: Pick<Headers, "get">): string | null {
  const value = headers.get(CLIENT_IP_HEADER)?.trim() ?? "";
  return isIP(value) ? value : null;
}

// What an unknown address counts as: all such bookings share one bucket, so a
// missing header limits more, never less.
const UNKNOWN_IP = "unknown";

// HMAC-SHA256 of the address (hex), keyed with BOOKING_IP_SECRET. Only this
// is stored: a plain hash isn't enough, because every IP address can be
// guessed and hashed.
export function hashClientIp(ip: string | null, secret: string = getServerEnv().BOOKING_IP_SECRET): string {
  return createHmac("sha256", secret).update(ip ?? UNKNOWN_IP).digest("hex");
}
