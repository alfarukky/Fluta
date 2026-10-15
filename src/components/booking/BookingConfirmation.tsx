"use client";

import { CircleCheckIcon } from "lucide-react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import type { BookingOptions } from "@/types/booking";

import type { BookingDraft, BookingReview } from "./booking-draft";
import { describePickupTime, describeReviewLine, PriceSummary } from "./booking-summary";

interface BookingConfirmationProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  storeName: string;
  displayNumber: string;
  draft: BookingDraft;
  review: BookingReview;
  options: BookingOptions;
  onStartAgain: () => void;
}

// The order number, a short summary, and what happens next.
export function BookingConfirmation({
  headingRef,
  storeName,
  displayNumber,
  draft,
  review,
  options,
  onStartAgain,
}: BookingConfirmationProps) {
  const pickup = draft.fulfilmentType === "PICKUP_DELIVERY";
  const next = pickup
    ? `We've received your booking. ${storeName} will confirm your pickup time.`
    : `We've received your booking. Bring your laundry to ${storeName} and mention your order number.`;

  return (
    <section className="flex flex-col gap-section" aria-labelledby="booking-confirmed-heading">
      <div className="flex flex-col items-start gap-component">
        <span className="flex size-11 items-center justify-center rounded-full bg-success/15 text-success">
          <CircleCheckIcon className="size-6" aria-hidden />
        </span>
        <h2 id="booking-confirmed-heading" ref={headingRef} tabIndex={-1} className="type-h1 scroll-mt-4 text-foreground outline-none">
          Booking received
        </h2>
        <p className="type-body text-foreground">{next}</p>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-card">
        <span className="type-caption text-muted-foreground">Your order number</span>
        <span className="type-h2 text-card-foreground">{displayNumber}</span>
        <span className="type-body-sm text-muted-foreground">Keep this number in case you need to contact the store.</span>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-card">
        <h3 className="type-label text-muted-foreground">Summary</h3>
        <ul className="flex flex-col gap-2">
          {review.lines.map((line) => (
            <li key={line.serviceId} className="type-body-sm text-foreground">
              {line.name}{" "}
              <span className="text-muted-foreground">
                {describeReviewLine(line, options.services.find((service) => service.id === line.serviceId))}
              </span>
            </li>
          ))}
        </ul>
        <p className="type-body-sm text-foreground">
          {pickup ? `Pickup requested for ${describePickupTime(draft)}` : "Drop-off at the store"}
        </p>
        <PriceSummary review={review} />
      </div>

      <Button type="button" variant="outline" onClick={onStartAgain} className="self-start">
        Make another booking
      </Button>
    </section>
  );
}
