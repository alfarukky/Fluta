import "server-only";

import { randomUUID } from "node:crypto";

import { getServerEnv } from "./env";

// Logo object keys are generated here, by Fluta, never taken from a request:
// "stores/{storeId}/logo/{uuid}.{ext}". A new key per upload, so a replaced
// logo never shows from a cache.
const LOGO_KEY_PATTERN = /^stores\/[a-z0-9]+\/logo\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

export function createLogoKey(storeId: string, extension: "png" | "jpg" | "webp"): string {
  return `stores/${storeId}/logo/${randomUUID()}.${extension}`;
}

// The logo's public address on R2: R2_PUBLIC_URL + key. The only place logo
// addresses are built; they are never stored. A key that isn't one of ours
// gives no logo rather than an address.
export function getLogoUrl(
  store: { logoKey: string | null },
  publicUrl: string = getServerEnv().R2_PUBLIC_URL,
): string | null {
  if (!store.logoKey || !LOGO_KEY_PATTERN.test(store.logoKey)) return null;
  return new URL(store.logoKey, publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`).toString();
}
