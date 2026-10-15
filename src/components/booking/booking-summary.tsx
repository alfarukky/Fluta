import { formatCalendarDate } from "@/lib/time";
import { formatNaira } from "@/lib/money";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import { formatQuantity, isWeighed } from "@/lib/quantity";
import type { BookingOptions, BookingService } from "@/types/booking";

import { parseWindowKey, type BookingDraft, type BookingReview, type ReviewLine } from "./booking-draft";

// Shared wording for the review step and the confirmation.

// "× 3 · ₦2,400", "About 2.5 kg, your estimate", "× 2, the store confirms the price".
export function describeReviewLine(line: ReviewLine, service: BookingService | undefined): string {
  if (!service) return "";
  const weighed = isWeighed(service.pricingType);
  if (line.amount === null) return "The store will weigh it";
  const amount = formatQuantity(line.amount, service.pricingType);
  if (!line.isEstimate) return `× ${amount} · ${formatNaira(line.lineTotal ?? 0)}`;
  return weighed ? `About ${amount}, your estimate` : `× ${amount}, the store will confirm the price`;
}

export function describePickupCharge(review: BookingReview): string {
  if (review.pickupCharge === null) return "The store will confirm this price after you book";
  return review.pickupCharge === 0 ? "Free" : formatNaira(review.pickupCharge);
}

export function describePickupTime(draft: BookingDraft): string {
  const window = parseWindowKey(draft.window);
  const date = draft.date ? formatCalendarDate(draft.date) : "";
  return window ? `${date}, ${formatPickupWindow(window)}` : date;
}

export function findArea(draft: BookingDraft, options: BookingOptions) {
  return options.areas.find((area) => area.id === draft.areaId);
}

// The price part of the review: a total, an estimated total, or no number.
export function PriceSummary({ review }: { review: BookingReview }) {
  const { summary } = review;
  if (summary.kind === "total") {
    return (
      <div className="flex items-baseline justify-between gap-component">
        <span className="type-label text-foreground">Total</span>
        <span className="type-h3 text-foreground">{formatNaira(summary.total)}</span>
      </div>
    );
  }
  if (summary.kind === "estimate") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-component">
          <span className="type-label text-foreground">Estimated total</span>
          <span className="type-h3 text-foreground">{formatNaira(summary.total)}</span>
        </div>
        <p className="type-body-sm text-muted-foreground">Final price after the store weighs or inspects your items.</p>
      </div>
    );
  }
  return <p className="type-body text-foreground">The store will confirm the final price after checking your items.</p>;
}
