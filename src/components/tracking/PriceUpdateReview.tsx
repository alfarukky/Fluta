"use client";

import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { decidePriceUpdate } from "@/actions/tracking";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CUSTOMER_MESSAGE_MAX } from "@/schemas/tracking";
import type { PriceUpdateReview as Review } from "@/types/tracking";

import { Card, ItemList, Row } from "./TrackingOrder";
import { useTrackingAction } from "./use-tracking-action";

interface PriceUpdateReviewProps {
  token: string;
  orderPath: string;
  review: Review;
}

const DIRECTION_ICONS = { up: TrendingUpIcon, down: TrendingDownIcon, same: MinusIcon } as const;

// The price update in full, with Approve and "Decline or ask a question"
// (a decline with an optional message to the store).
export function PriceUpdateReview({ token, orderPath, review }: PriceUpdateReviewProps) {
  const id = useId();
  const [declining, setDeclining] = useState(false);
  const [message, setMessage] = useState("");
  const { pending, run } = useTrackingAction(orderPath);
  const DirectionIcon = review.direction ? DIRECTION_ICONS[review.direction] : null;
  const hint = `Optional. Up to ${CUSTOMER_MESSAGE_MAX} characters. The store will see it.`;

  function decline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(() => decidePriceUpdate(token, { decision: "DECLINE", revisionId: review.revisionId, message: message.trim() || null }));
  }

  return (
    <>
      <section className="flex flex-col gap-component rounded-xl border border-primary/40 bg-card p-card">
        <div className="flex flex-col gap-1">
          {review.previousTotal && <Row label="Previous total" value={review.previousTotal} />}
          <Row label="New total" value={review.newTotal} strong />
        </div>
        {review.difference && DirectionIcon && (
          <p className="type-h3 flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-foreground">
            <DirectionIcon className="size-5 shrink-0 text-primary" aria-hidden />
            <span>
              {review.direction === "same" ? "No change to your total" : `Difference: ${review.difference}`}
            </span>
          </p>
        )}
        {review.reason && (
          <div className="flex flex-col gap-0.5">
            <span className="type-caption text-muted-foreground">From the store</span>
            <p className="type-body-sm break-words whitespace-pre-line text-card-foreground">{review.reason}</p>
          </div>
        )}
      </section>

      <Card title="Items">
        <ItemList items={review.items} />
        {review.charge && (
          <div className="border-t border-border pt-component">
            <Row label="Pickup & delivery" value={review.charge} />
          </div>
        )}
      </Card>

      {declining ? (
        <form onSubmit={decline} className="flex flex-col gap-form" noValidate>
          <FormField id={`${id}-message`} label="Message to the store" hint={hint}>
            <Textarea
              id={`${id}-message`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={CUSTOMER_MESSAGE_MAX}
              rows={3}
              aria-describedby={describedBy(`${id}-message`, hint, undefined)}
              autoFocus
            />
          </FormField>
          <div className="flex flex-col gap-2 xs:flex-row">
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Decline and send"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeclining(false)} disabled={pending}>
              Back
            </Button>
          </div>
          <p className="type-caption text-muted-foreground">Declining doesn&apos;t change your order. The store will get back to you.</p>
        </form>
      ) : (
        <div className="flex flex-col gap-2 xs:flex-row">
          <Button
            onClick={() => run(() => decidePriceUpdate(token, { decision: "APPROVE", revisionId: review.revisionId }))}
            disabled={pending}
          >
            {pending ? "Approving…" : "Approve"}
          </Button>
          <Button variant="outline" onClick={() => setDeclining(true)} disabled={pending}>
            Decline or ask a question
          </Button>
        </div>
      )}
    </>
  );
}
