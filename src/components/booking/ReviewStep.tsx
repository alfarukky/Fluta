"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { BookingOptions, BookingStep } from "@/types/booking";

import type { BookingDraft, BookingReview } from "./booking-draft";
import { describePickupCharge, describePickupTime, describeReviewLine, findArea, PriceSummary } from "./booking-summary";

interface ReviewStepProps {
  draft: BookingDraft;
  options: BookingOptions;
  review: BookingReview;
  onEdit: (step: BookingStep) => void;
}

// Everything the customer chose, with the price worked out from the store's
// own prices (the server works it out again when the booking is sent).
export function ReviewStep({ draft, options, review, onEdit }: ReviewStepProps) {
  const pickup = draft.fulfilmentType === "PICKUP_DELIVERY";
  const area = findArea(draft, options);
  const note = draft.note.trim();

  return (
    <div className="flex flex-col gap-component">
      <ReviewSection title="Services" onEdit={() => onEdit("services")}>
        <ul className="flex flex-col gap-2">
          {review.lines.map((line) => (
            <li key={line.serviceId} className="flex flex-col">
              <span className="type-label break-words text-foreground">{line.name}</span>
              <span className="type-body-sm text-muted-foreground">
                {describeReviewLine(line, options.services.find((service) => service.id === line.serviceId))}
              </span>
            </li>
          ))}
        </ul>
        {note && (
          <div className="flex flex-col gap-0.5 border-t border-border pt-3">
            <span className="type-caption text-muted-foreground">Your note</span>
            <p className="type-body-sm break-words whitespace-pre-line text-foreground">{note}</p>
          </div>
        )}
      </ReviewSection>

      <ReviewSection title={pickup ? "Pickup and delivery" : "Drop-off"} onEdit={() => onEdit(pickup ? "pickup" : "fulfilment")}>
        {pickup ? (
          <dl className="type-body-sm grid gap-1 text-foreground">
            <Detail term="Area">{area?.name}</Detail>
            <Detail term="Address">{draft.address.trim()}</Detail>
            <Detail term="Preferred time">{describePickupTime(draft)}</Detail>
            <Detail term="Pickup & delivery">{describePickupCharge(review)}</Detail>
          </dl>
        ) : (
          <p className="type-body-sm text-foreground">You&apos;ll bring your laundry to the store.</p>
        )}
      </ReviewSection>

      <ReviewSection title="Your details" onEdit={() => onEdit("details")}>
        <dl className="type-body-sm grid gap-1 text-foreground">
          <Detail term="Name">{draft.name.trim()}</Detail>
          <Detail term="Phone">{draft.phone.trim()}</Detail>
          {draft.email.trim() && <Detail term="Email">{draft.email.trim()}</Detail>}
        </dl>
      </ReviewSection>

      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-card" aria-label="Price">
        <PriceSummary review={review} />
        {note && <p className="type-body-sm text-foreground">The store may update your price after reading your note.</p>}
        <p className="type-caption text-muted-foreground">No payment is needed now. You&apos;ll pay the store later.</p>
      </section>
    </div>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-card" aria-label={title}>
      <div className="flex items-center justify-between gap-component">
        <h3 className="type-label text-muted-foreground">{title}</h3>
        <Button type="button" variant="link" onClick={onEdit} aria-label={`Change ${title.toLowerCase()}`}>
          Change
        </Button>
      </div>
      {children}
    </section>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col xs:flex-row xs:gap-2">
      <dt className="shrink-0 text-muted-foreground xs:w-36">{term}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
