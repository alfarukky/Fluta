import { ArrowUpRightIcon, LinkIcon, PaletteIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { BrandColorSwatch } from "@/components/workspace/BrandColorSwatch";
import { CopyLinkButton } from "@/components/workspace/CopyLinkButton";
import { SETTINGS_PATH } from "@/components/workspace/nav-items";
import { PageHeader } from "@/components/workspace/PageHeader";
import { summarizeStoreStatus } from "@/components/workspace/store-status";
import { getBookingUrl } from "@/lib/booking-link";
import { requireStoreMember } from "@/server/auth/session";

export const metadata: Metadata = { title: "Overview · Fluta" };

// Getting-started view until the dashboard arrives (Feature 20).
export default async function OverviewPage() {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  const { store } = member;
  const status = summarizeStoreStatus(store.status, member.access, member.membership.role);
  const bookingUrl = getBookingUrl(store);
  const isOwner = member.membership.role === "OWNER";

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader title="Store overview" description="Welcome to your store workspace." />

      <div className="grid gap-grid sm:grid-cols-2 xl:grid-cols-4">
        <DetailCard label="Store status" hint={status.description}>
          <Badge variant={status.variant} dot>
            {status.label}
          </Badge>
        </DetailCard>
        <DetailCard label="Store name" hint="Shown to your customers">
          <p className="type-h3 break-words text-foreground">{store.name}</p>
        </DetailCard>
        <DetailCard label="Store slug" hint="Your store's address on Fluta">
          <p className="type-h3 break-all text-foreground">/{store.slug}</p>
        </DetailCard>
        <DetailCard label="Brand colour" hint="Used on your customer pages">
          <BrandColorSwatch color={store.brandPrimaryColor} />
        </DetailCard>
      </div>

      <div className="grid gap-grid lg:grid-cols-3">
        <Card className={isOwner ? "lg:col-span-2" : "lg:col-span-3"}>
          <CardContent className="flex flex-col gap-component">
            <p className="type-label flex items-center gap-2 text-primary dark:text-accent-foreground">
              <LinkIcon className="size-4" aria-hidden />
              Customer booking link
            </p>
            <p className="type-h2 break-all text-foreground">{displayUrl(bookingUrl)}</p>
            <p className="type-body-sm text-muted-foreground">
              Share this link with customers so they can book a laundry service with you.
            </p>
            <div className="mt-2">
              <CopyLinkButton url={bookingUrl} />
            </div>
          </CardContent>
        </Card>

        {isOwner && (
          <Card className="bg-accent">
            <CardContent className="flex flex-col gap-component">
              <span className="flex size-10 items-center justify-center rounded-lg bg-card text-primary dark:text-accent-foreground">
                <PaletteIcon className="size-5" aria-hidden />
              </span>
              <p className="type-h3 text-accent-foreground">Make it yours</p>
              <p className="type-body-sm text-accent-foreground/80">
                Add your logo and brand colour so customers recognise your store.
              </p>
              <Link
                href={SETTINGS_PATH}
                className="type-label mt-1 inline-flex w-fit items-center gap-1 rounded-sm text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Set up branding
                <ArrowUpRightIcon className="size-4" aria-hidden />
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

function DetailCard({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3">
        <p className="type-body-sm text-muted-foreground">{label}</p>
        <div>{children}</div>
        <p className="type-caption mt-auto text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

// "https://app.example/s/freshfold" → "app.example/s/freshfold"
function displayUrl(url: string): string {
  const { host, pathname } = new URL(url);
  return `${host}${pathname}`;
}
