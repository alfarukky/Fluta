import Link from "next/link";

import { Logo } from "./Logo";

// The footer of customer pages: a small, quiet mark that never competes with
// the store's own logo, and the privacy notice. Muted tokens only, which store
// branding never changes.
export function PoweredByFluta() {
  return (
    <footer className="mx-auto flex w-full max-w-xl items-center justify-center gap-3 px-page pb-6 type-caption text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Logo variant="symbol" tone="mono" size="xs" decorative />
        Powered by Fluta
      </span>
      <span aria-hidden>·</span>
      <Link
        href="/privacy"
        className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        Privacy
      </Link>
    </footer>
  );
}
