import "server-only";

import { getServerEnv } from "./env";
import { createQrCodePng } from "./qr-code";

// The store's customer booking link, /store/{slug} on Fluta's domain. Always
// build it here: links are printed on QR codes, so the format must not drift.
export function getBookingUrl(store: { slug: string }, baseUrl: string = getServerEnv().BETTER_AUTH_URL): string {
  return new URL(`/store/${encodeURIComponent(store.slug)}`, baseUrl).toString();
}

// The link and its QR code, built together so Copy and the QR code can never
// point at different addresses.
export async function getBookingShare(
  store: { slug: string },
  baseUrl?: string,
): Promise<{ bookingUrl: string; qrCodePng: string }> {
  const bookingUrl = getBookingUrl(store, baseUrl);
  return { bookingUrl, qrCodePng: await createQrCodePng(bookingUrl) };
}
