"use client";

import { CalendarClockIcon, PhoneIcon } from "lucide-react";

import { acceptPickupTime } from "@/actions/tracking";
import { Button } from "@/components/ui/button";
import type { PickupSuggestionReview as Review } from "@/types/tracking";

import { useTrackingAction } from "./use-tracking-action";

interface PickupSuggestionReviewProps {
  token: string;
  orderPath: string;
  review: Review;
  storePhoneHref: string | null;
}

// The pickup time the store suggested: Accept, or contact the store to
// arrange another.
export function PickupSuggestionReview({ token, orderPath, review, storePhoneHref }: PickupSuggestionReviewProps) {
  const { pending, run } = useTrackingAction(orderPath);
  return (
    <>
      <section className="flex flex-col gap-component rounded-xl border border-primary/40 bg-card p-card">
        <div className="flex items-start gap-3">
          <CalendarClockIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="type-caption text-muted-foreground">Suggested by the store</span>
            <p className="type-h3 text-card-foreground">{review.date}</p>
            <p className="type-body text-card-foreground">{review.time}</p>
          </div>
        </div>
        {review.requested && <p className="type-body-sm text-muted-foreground">You asked for {review.requested}.</p>}
      </section>
      <div className="flex flex-col gap-2 xs:flex-row">
        <Button onClick={() => run(() => acceptPickupTime(token, { suggestionId: review.suggestionId }))} disabled={pending}>
          {pending ? "Accepting…" : "Accept"}
        </Button>
        {storePhoneHref && (
          <Button asChild variant="outline">
            <a href={storePhoneHref}>
              <PhoneIcon data-icon="inline-start" aria-hidden />
              Contact the store
            </a>
          </Button>
        )}
      </div>
    </>
  );
}
