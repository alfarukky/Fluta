import "server-only";

import { createHash } from "node:crypto";

import { ImageResponse } from "next/og";
import sharp from "sharp";

import { getBrandFill } from "@/lib/brand-theme";
import { getBookingPath, getBookingUrl } from "@/lib/booking-link";
import { logger } from "@/lib/logger";
import { getInitials } from "@/lib/names";
import { getAppShortName } from "@/lib/store-app";
import { getObjectStorage } from "@/server/integrations/r2";

import type { BookableStore } from "./booking";

// Each store's home-screen app (manifest and icons) and link-preview image.
// Drawn only from the store's own saved data: its name, its brand colour, and
// the logo read from R2 by its saved key. Nothing in the request (no address,
// no colour) ever reaches these images, so nobody can make Fluta fetch an
// address of their choosing.

export const APP_ICONS = {
  "icon-192": { size: 192, logoShare: 0.72 },
  "icon-512": { size: 512, logoShare: 0.72 },
  // Phones crop maskable icons to a circle or squircle: the logo stays inside
  // the safe zone (the middle 80%).
  "maskable-512": { size: 512, logoShare: 0.56 },
  // iPhones round the corners themselves and need an opaque square.
  "apple-180": { size: 180, logoShare: 0.72 },
} as const;
export type AppIconId = keyof typeof APP_ICONS;

export const PREVIEW_IMAGE_SIZE = { width: 1200, height: 630 };

const LOGO_PIXELS = 512;
// The versioned addresses below never change for the same branding, so
// browsers and link previews may keep them.
const IMMUTABLE = "public, max-age=31536000, immutable";

export function isAppIconId(id: string): id is AppIconId {
  return Object.hasOwn(APP_ICONS, id);
}

// Changes whenever the name, logo, or brand colour does, so a new icon or
// preview gets a new address.
export function getBrandingVersion(bookable: BookableStore): string {
  const { name, brandPrimaryColor } = bookable.store;
  return createHash("sha256")
    .update(JSON.stringify([name, bookable.logoKey, brandPrimaryColor]))
    .digest("hex")
    .slice(0, 12);
}

export function getAppIconPath(bookable: BookableStore, id: AppIconId): string {
  return `${getBookingPath(bookable.store)}/app-icon/${id}?v=${getBrandingVersion(bookable)}`;
}

export function getPreviewImagePath(bookable: BookableStore): string {
  return `${getBookingPath(bookable.store)}/preview-image?v=${getBrandingVersion(bookable)}`;
}

// The store's web app manifest: its own name and icons, opening its booking
// page full-screen.
export function buildStoreManifest(bookable: BookableStore) {
  const { name, description, slug } = bookable.store;
  const fill = getBrandFill({ primary: bookable.store.brandPrimaryColor });
  const startUrl = new URL(getBookingUrl({ slug })).pathname;
  const icon = (id: AppIconId, purpose: "any" | "maskable") => ({
    src: getAppIconPath(bookable, id),
    sizes: `${APP_ICONS[id].size}x${APP_ICONS[id].size}`,
    type: "image/png",
    purpose,
  });
  return {
    id: startUrl,
    name,
    short_name: getAppShortName(name),
    description: description ?? `Book your laundry with ${name}`,
    start_url: startUrl,
    scope: startUrl,
    display: "standalone",
    theme_color: fill.background,
    background_color: fill.background,
    icons: [icon("icon-192", "any"), icon("icon-512", "any"), icon("maskable-512", "maskable")],
  };
}

export async function renderAppIcon(bookable: BookableStore, id: AppIconId): Promise<ImageResponse> {
  const { size, logoShare } = APP_ICONS[id];
  const fill = getBrandFill({ primary: bookable.store.brandPrimaryColor });
  const logo = await loadLogo(bookable);
  const mark = Math.round(size * logoShare);
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: fill.background }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not the browser
          <img src={logo} alt="" width={mark} height={mark} style={{ objectFit: "contain" }} />
        ) : (
          <span style={{ color: fill.foreground, fontSize: Math.round(size * 0.4), fontWeight: 700, letterSpacing: -1 }}>
            {getInitials(bookable.store.name)}
          </span>
        )}
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": IMMUTABLE } },
  );
}

// The link-preview card: the logo (or initials) and the store's name on its
// brand colour. Only for a bookable store: a Deactivated one has no preview.
export async function renderPreviewImage(bookable: BookableStore): Promise<ImageResponse> {
  const fill = getBrandFill({ primary: bookable.store.brandPrimaryColor });
  const logo = await loadLogo(bookable);
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          padding: 80,
          background: fill.background,
          color: fill.foreground,
        }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not the browser
          <img src={logo} alt="" width={240} height={240} style={{ objectFit: "contain" }} />
        ) : (
          <span style={{ fontSize: 140, fontWeight: 700 }}>{getInitials(bookable.store.name)}</span>
        )}
        <span style={{ fontSize: 64, fontWeight: 700, textAlign: "center", lineHeight: 1.1 }}>{bookable.store.name}</span>
      </div>
    ),
    { ...PREVIEW_IMAGE_SIZE, headers: { "Cache-Control": IMMUTABLE } },
  );
}

// The logo as a PNG data URI, read from R2 by the store's saved key and
// redrawn by sharp (next/og can't draw WebP, and this also proves the file is
// a real image). Null, so the initials are drawn instead, when there is no
// logo or it can't be read.
async function loadLogo(bookable: BookableStore): Promise<string | null> {
  if (!bookable.logoKey) return null;
  try {
    const bytes = await getObjectStorage().get(bookable.logoKey);
    if (!bytes) return null;
    const png = await sharp(bytes, { limitInputPixels: 2000 * 2000 })
      .resize(LOGO_PIXELS, LOGO_PIXELS, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (error) {
    logger.warn(`[store-app] drawing the logo of store ${bookable.id} failed:`, error instanceof Error ? error.name : "unknown error");
    return null;
  }
}
