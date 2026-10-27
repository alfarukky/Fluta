import { formatCalendarDate } from "@/lib/time";
import { formatNaira } from "@/lib/money";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import type { BookingService } from "@/types/booking";

import { parseWindowKey, type BookingDraft, type BookingReview, type ReviewLine } from "./booking-draft";

// Shared wording for the review step and the confirmation.

// "× 3 · ₦2,400", "× 2, the store will confirm the price".
export function describeReviewLine(line: ReviewLine, service: BookingService | undefined): string {
  if (!service || line.amount === null) return "";
  if (!line.isEstimate) return `× ${line.amount} · ${formatNaira(line.lineTotal ?? 0)}`;
  return `× ${line.amount}, the store will confirm the price`;
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
        <p className="type-body-sm text-muted-foreground">Final price after the store inspects your items.</p>
      </div>
    );
  }
  return <p className="type-body text-foreground">The store will confirm the final price after checking your items.</p>;
}
