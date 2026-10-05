import "server-only";

import { getServerEnv } from "./env";

// The store's customer booking link. Its format is still (Open) in the
// project overview, so it is built only here.
export function getBookingUrl(store: { slug: string }, baseUrl: string = getServerEnv().BETTER_AUTH_URL): string {
  return new URL(`/s/${encodeURIComponent(store.slug)}`, baseUrl).toString();
}
