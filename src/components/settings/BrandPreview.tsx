"use client";

import { cn } from "cn";
import Image from "next/image";

import { getBrandTheme, type BrandColors } from "@/lib/brand-theme";
import { getInitials } from "@/lib/names";

interface BrandPreviewProps {
  storeName: string;
  logoUrl: string | null;
  colors: BrandColors;
}

// The customer page header with the chosen colours, light and dark side by
// side. Each panel is a branded root built by getBrandTheme(), exactly as the
// customer layout will be (Feature 13); invalid colours fall back to Fluta's.
export function BrandPreview({ storeName, logoUrl, colors }: BrandPreviewProps) {
  return (
    <div className="grid gap-component md:grid-cols-2">
      <PreviewPanel scheme="light" storeName={storeName} logoUrl={logoUrl} colors={colors} />
      <PreviewPanel scheme="dark" storeName={storeName} logoUrl={logoUrl} colors={colors} />
    </div>
  );
}

function PreviewPanel({ scheme, storeName, logoUrl, colors }: BrandPreviewProps & { scheme: "light" | "dark" }) {
  const label = scheme === "light" ? "Light theme" : "Dark theme";
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="type-caption text-muted-foreground">{label}</figcaption>
      {/* Only non-dark: classes inside: this panel sets its own theme. */}
      <div
        {...getBrandTheme(colors)}
        className={cn(scheme, "overflow-hidden rounded-lg border border-border bg-background text-foreground")}
        aria-label={`${label} preview of your booking page`}
        role="img"
      >
        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
          <StoreMark storeName={storeName} logoUrl={logoUrl} />
          <p className="type-label min-w-0 truncate text-card-foreground">{storeName}</p>
        </div>
        <div className="flex flex-col items-start gap-3 p-4">
          <span className="type-caption rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground">
            Open today
          </span>
          <p className="type-h3">Fresh laundry, picked up and delivered</p>
          <p className="type-body-sm text-primary">Track every order from your phone.</p>
          <span className="type-label inline-flex h-11 items-center rounded-lg bg-primary px-4 text-primary-foreground">
            Book a service
          </span>
        </div>
      </div>
    </figure>
  );
}

function StoreMark({ storeName, logoUrl }: { storeName: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <span className="relative size-10 shrink-0 overflow-hidden rounded-md">
        {/* Loaded straight from R2's public domain, never through the app. */}
        <Image src={logoUrl} alt="" fill sizes="40px" unoptimized className="object-contain" />
      </span>
    );
  }
  return (
    <span className="type-label flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
      {getInitials(storeName)}
    </span>
  );
}
