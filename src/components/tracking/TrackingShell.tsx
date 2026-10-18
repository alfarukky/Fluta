import type { ReactNode } from "react";

import { StoreHeader } from "@/components/booking/StoreHeader";
import { PoweredByFluta } from "@/components/brand/PoweredByFluta";
import { getBrandTheme } from "@/lib/brand-theme";
import type { PublicStore } from "@/types/booking";

// The tracking pages' frame: the store's branding and header, like its
// booking page. With no store (an invalid or unavailable link), Fluta's own
// plain look and nothing about any store.
export function TrackingShell({ store, children }: { store: PublicStore | null; children: ReactNode }) {
  return (
    // The one inline style allowed: the store's validated brand colours as
    // CSS variables (getBrandTheme).
    <div
      {...(store ? getBrandTheme({ primary: store.brandPrimaryColor, accent: store.brandAccentColor }) : {})}
      className="flex min-h-dvh flex-1 flex-col bg-background text-foreground"
    >
      {store && <StoreHeader store={store} />}
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-section px-page pt-6 pb-section">{children}</main>
      <PoweredByFluta />
    </div>
  );
}
