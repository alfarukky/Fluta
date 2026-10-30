import Image from "next/image";

import { getInitials } from "@/lib/names";
import type { PublicStore } from "@/types/booking";

// The store's logo, name, and description at the top of its pages. The
// description is plain text, rendered escaped.
export function StoreHeader({ store }: { store: PublicStore }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-page py-4">
        <StoreMark name={store.name} logoUrl={store.logoUrl} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="type-h3 wrap-break-word text-card-foreground">{store.name}</h1>
          {store.description && <p className="type-body-sm wrap-break-word text-muted-foreground">{store.description}</p>}
        </div>
      </div>
    </header>
  );
}

function StoreMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <span className="relative size-12 shrink-0 overflow-hidden rounded-md">
        {/* Loaded straight from R2's public domain, never through the app. */}
        <Image src={logoUrl} alt={`${name} logo`} fill sizes="48px" unoptimized priority className="object-contain" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="type-label flex size-12 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
    >
      {getInitials(name)}
    </span>
  );
}
