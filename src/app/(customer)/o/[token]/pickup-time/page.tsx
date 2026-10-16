import { ArrowLeftIcon, CalendarClockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PickupSuggestionReview } from "@/components/tracking/PickupSuggestionReview";
import { getTrackingMetadata, renderTrackingPage, trackingPath } from "@/components/tracking/tracking-page";
import { TrackingMessage } from "@/components/tracking/TrackingMessage";
import { Button } from "@/components/ui/button";

// Reviewing a pickup time the store suggested: accept it, or contact the store.

export async function generateMetadata({ params }: PageProps<"/o/[token]/pickup-time">): Promise<Metadata> {
  return getTrackingMetadata((await params).token);
}

export default async function PickupTimePage({ params }: PageProps<"/o/[token]/pickup-time">) {
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
          <h2 className="type-h1 text-foreground">Pickup time</h2>
        </div>
      </header>
      {view.pickupSuggestion && !view.priceUpdate ? (
        <PickupSuggestionReview
          token={token}
          orderPath={orderPath}
          review={view.pickupSuggestion}
          storePhoneHref={view.store.phoneHref}
        />
      ) : (
        <TrackingMessage
          icon={CalendarClockIcon}
          title="Nothing to review"
          description={
            view.priceUpdate
              ? "Please review the price update first."
              : view.closed
                ? "This order can't be changed any more."
                : "This order was just updated. Please check the latest details."
          }
          back={{ label: "Back to your order", href: orderPath }}
        />
      )}
    </>
  ));
}
