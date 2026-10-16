import { ArrowLeftIcon, ReceiptTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PriceUpdateReview } from "@/components/tracking/PriceUpdateReview";
import { getTrackingMetadata, renderTrackingPage, trackingPath } from "@/components/tracking/tracking-page";
import { TrackingMessage } from "@/components/tracking/TrackingMessage";
import { Button } from "@/components/ui/button";
import { TRACKING_MESSAGES } from "@/server/services/tracking";

// Reviewing a price update from the store: approve it, or decline it (with
// an optional message).

export async function generateMetadata({ params }: PageProps<"/o/[token]/price-update">): Promise<Metadata> {
  return getTrackingMetadata((await params).token);
}

export default async function PriceUpdatePage({ params }: PageProps<"/o/[token]/price-update">) {
  const { token } = await params;
  const orderPath = trackingPath(token);
  return renderTrackingPage(token, (view) => (
    <>
      <header className="flex flex-col gap-component">
        <Button asChild variant="link" className="h-auto self-start px-0">
          <Link href={orderPath}>
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            Back to your order
          </Link>
        </Button>
        <div className="flex flex-col gap-1">
          <p className="type-label text-muted-foreground">Order {view.displayNumber}</p>
          <h2 className="type-h1 text-foreground">Price update</h2>
        </div>
      </header>
      {view.priceUpdate ? (
        <PriceUpdateReview token={token} orderPath={orderPath} review={view.priceUpdate} />
      ) : (
        <TrackingMessage
          icon={ReceiptTextIcon}
          title="Nothing to review"
          description={view.closed ? "This order can't be changed any more." : TRACKING_MESSAGES.priceNotCurrent}
          back={{ label: "Back to your order", href: orderPath }}
        />
      )}
    </>
  ));
}
