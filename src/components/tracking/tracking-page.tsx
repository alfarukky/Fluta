import { LinkIcon, StoreIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getTrackingUrl } from "@/lib/tracking-link";
import { loadTrackingPage, TRACKING_MESSAGES } from "@/server/services/tracking";
import type { TrackingView } from "@/types/tracking";

import { TrackingMessage } from "./TrackingMessage";
import { TrackingShell } from "./TrackingShell";

// Shared by every page under /o/{token}. The token is the only credential:
// an unknown one is a real 404 (checked before anything streams), and a link
// preview shows only the store's name and "View your laundry order", never
// the customer, items, amounts, stage, or address. next.config.ts sends
// no-referrer and no-store, and the pages are never indexed.

const PRIVATE = { robots: { index: false, follow: false }, referrer: "no-referrer" } as const satisfies Metadata;
const PREVIEW_DESCRIPTION = "View your laundry order";

export async function getTrackingMetadata(token: string): Promise<Metadata> {
  const page = await loadTrackingPage(token);
  const storeName = page.kind === "VALID" ? page.view.store.name : page.kind === "EXPIRED" ? page.storeName : null;
  if (!storeName) return { title: "Order not available", ...PRIVATE };
  return {
    title: storeName,
    description: PREVIEW_DESCRIPTION,
    openGraph: { type: "website", siteName: storeName, title: storeName, description: PREVIEW_DESCRIPTION },
    twitter: { card: "summary", title: storeName, description: PREVIEW_DESCRIPTION },
    ...PRIVATE,
  };
}

// The order for a valid link, or the page for an invalid, expired, or
// unavailable one.
export async function renderTrackingPage(token: string, render: (view: TrackingView) => ReactNode): Promise<ReactNode> {
  const page = await loadTrackingPage(token);
  switch (page.kind) {
    case "NOT_FOUND":
      notFound();
    case "UNAVAILABLE":
      return (
        <TrackingShell store={null}>
          <TrackingMessage icon={StoreIcon} headingLevel="h1" title="Order not available" description={TRACKING_MESSAGES.unavailable} />
        </TrackingShell>
      );
    case "EXPIRED":
      return (
        <TrackingShell store={null}>
          <TrackingMessage
            icon={LinkIcon}
            headingLevel="h1"
            title="Link expired"
            description={TRACKING_MESSAGES.expired(page.storeName)}
            call={page.storePhoneHref && page.storePhone ? { label: `Call ${page.storePhone}`, href: page.storePhoneHref } : null}
          />
        </TrackingShell>
      );
    case "VALID":
      return <TrackingShell store={page.view.store}>{render(page.view)}</TrackingShell>;
  }
}

// The tracking page's own path, for links within it. Taken from
// getTrackingUrl so the link format lives in one place.
export function trackingPath(token: string): string {
  return new URL(getTrackingUrl(token)).pathname;
}
