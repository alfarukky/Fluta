import "server-only";

import { getServerEnv } from "./env";

// The store's customer booking link, /store/{slug} on Fluta's domain. Always
// build it here: links are printed on QR codes, so the format must not drift.
export function getBookingUrl(store: { slug: string }, baseUrl: string = getServerEnv().BETTER_AUTH_URL): string {
  return new URL(`/store/${encodeURIComponent(store.slug)}`, baseUrl).toString();
}
