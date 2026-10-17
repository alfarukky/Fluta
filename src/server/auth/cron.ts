import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

// The scheduled job's credential: "Authorization: Bearer <CRON_SECRET>",
// and nothing else (a signed-in session never counts). Both sides are hashed
// to the same length first, so the comparison takes the same time whatever
// was sent. Never log either value.
export function isCronAuthorized(authorization: string | null, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!match || secret.length === 0) return false;
  return timingSafeEqual(digest(match[1]), digest(secret));
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}
