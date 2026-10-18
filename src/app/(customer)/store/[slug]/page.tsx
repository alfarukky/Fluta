import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { AddToHomeScreenHint } from "@/components/booking/AddToHomeScreenHint";
import { BookingClosed } from "@/components/booking/BookingClosed";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { StoreHeader } from "@/components/booking/StoreHeader";
import { PoweredByFluta } from "@/components/brand/PoweredByFluta";
import { getBookingPath } from "@/lib/booking-link";
import { getBrandFill, getBrandTheme } from "@/lib/brand-theme";
import { getServerEnv } from "@/lib/env";
import { getAppShortName } from "@/lib/store-app";
import { storeSlugSchema } from "@/schemas/booking";
import { findBookableStore, loadBookingPage } from "@/server/services/booking";
import { getAppIconPath, getPreviewImagePath, PREVIEW_IMAGE_SIZE } from "@/server/services/store-app";

// The store's public booking page. No sign-in: the store comes only from the
// slug. An unknown slug or a Deactivated store is a 404 that says nothing
// about the store, in the page and in its link preview.

async function findStore(params: PageProps<"/store/[slug]">["params"]) {
  const slug = storeSlugSchema.safeParse((await params).slug);
  return slug.success ? findBookableStore(slug.data) : null;
}

export async function generateMetadata({ params }: PageProps<"/store/[slug]">): Promise<Metadata> {
  const bookable = await findStore(params);
  if (!bookable) return { title: "Store not available", robots: { index: false } };

  const { name, description, slug } = bookable.store;
  const line = description ?? `Book your laundry with ${name}`;
  const path = getBookingPath({ slug });
  return {
    metadataBase: new URL(getServerEnv().BETTER_AUTH_URL),
    title: name,
    description: line,
    alternates: { canonical: path },
    manifest: `${path}/manifest.webmanifest`,
    icons: {
      icon: [{ url: getAppIconPath(bookable, "icon-192"), sizes: "192x192", type: "image/png" }],
      apple: [{ url: getAppIconPath(bookable, "apple-180"), sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: { capable: true, title: getAppShortName(name), statusBarStyle: "default" },
    openGraph: {
      type: "website",
      url: path,
      siteName: name,
      title: name,
      description: line,
      images: [{ url: getPreviewImagePath(bookable), ...PREVIEW_IMAGE_SIZE, alt: name }],
    },
    twitter: { card: "summary_large_image", title: name, description: line, images: [getPreviewImagePath(bookable)] },
  };
}

export async function generateViewport({ params }: PageProps<"/store/[slug]">): Promise<Viewport> {
  const bookable = await findStore(params);
  return bookable ? { themeColor: getBrandFill({ primary: bookable.store.brandPrimaryColor }).background } : {};
}

export default async function StoreBookingPage({ params }: PageProps<"/store/[slug]">) {
  const slug = storeSlugSchema.safeParse((await params).slug);
  const page = slug.success ? await loadBookingPage(slug.data, new Date()) : null;
  if (!page) notFound();

  const { store, availability, options } = page;
  return (
    // The one inline style allowed: the store's validated brand colours as
    // CSS variables (getBrandTheme).
    <div
      {...getBrandTheme({ primary: store.brandPrimaryColor, accent: store.brandAccentColor })}
      className="flex min-h-dvh flex-1 flex-col bg-background text-foreground"
    >
      <StoreHeader store={store} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-section px-page pt-6 pb-section">
        {availability === "OPEN" ? (
          <BookingFlow slug={store.slug} storeName={store.name} options={options} />
        ) : (
          <BookingClosed store={store} availability={availability} services={options.services} />
        )}
      </main>
      <PoweredByFluta />
      <AddToHomeScreenHint slug={store.slug} storeName={store.name} />
    </div>
  );
}
