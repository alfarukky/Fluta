"use client";

import { CheckIcon, PlusIcon, StarIcon } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";

import { submitReview } from "@/actions/reviews";
import { RatingStars } from "@/components/reviews/RatingStars";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addSuggestion,
  describeRating,
  getRatingLabel,
  getReviewSuggestions,
  hasSuggestion,
  REVIEW_COMMENT_MAX,
  REVIEW_RATINGS,
} from "@/lib/reviews";
import { cn } from "@/lib/utils";
import type { TrackingReview } from "@/types/reviews";

interface ReviewCardProps {
  token: string;
  review: TrackingReview;
  // Shows the card's sample state only (the design system): never calls the server.
  preview?: boolean;
}

// Feature 19b: the customer's review card on their order page. The form while
// they can still review, then "Thank you for your review" with their stars.
export function ReviewCard({ token, review, preview = false }: ReviewCardProps) {
  // Saved just now: the thank-you card shows before the page refreshes.
  const [saved, setSaved] = useState<number | null>(null);
  if (review.kind === "thanks") return <ThankYouCard rating={review.rating} />;
  if (saved !== null) return <ThankYouCard rating={saved} />;
  return <ReviewForm token={token} storeName={review.storeName} preview={preview} onSaved={setSaved} />;
}

function ThankYouCard({ rating }: { rating: number }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-card">
      <h2 id={headingId} className="type-label text-card-foreground">
        Thank you for your review
      </h2>
      <RatingStars rating={rating} label={`You rated ${describeRating(rating)}`} />
    </section>
  );
}

interface ReviewFormProps {
  token: string;
  storeName: string;
  preview: boolean;
  onSaved: (rating: number) => void;
}

function ReviewForm({ token, storeName, preview, onSaved }: ReviewFormProps) {
  const id = useId();
  const [rating, setRating] = useState<number | null>(null);
  // Nothing is ever prefilled: text only enters when the customer types or taps a chip.
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const commentId = `${id}-comment`;
  const suggestions = getReviewSuggestions(rating);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || preview) return;
    if (rating === null) {
      setError("Choose a star rating");
      return;
    }
    setError(null);
    startTransition(async () => {
      let saved: number | null;
      try {
        const result = await submitReview(token, { rating, comment });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        saved = result.rating;
      } catch {
        setError("We couldn't reach the store. Check your connection and try again.");
        return;
      }
      // Saved now, or by an earlier submit (then its own stars): the thank-you card.
      onSaved(saved ?? rating);
    });
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-xl border border-primary/40 bg-primary/5 p-card">
      <form onSubmit={submit} noValidate className="flex flex-col gap-form">
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-heading`} className="type-h3 text-foreground">
            How was your laundry?
          </h2>
          <p className="type-body-sm text-muted-foreground">Rate your experience with {storeName}.</p>
        </div>

        <fieldset className="flex flex-col gap-1" aria-describedby={error && rating === null ? `${id}-error` : undefined}>
          <legend className="sr-only">Your rating</legend>
          <div className="-ml-1.5 flex">
            {REVIEW_RATINGS.map((star) => (
              <label
                key={star}
                className="cursor-pointer rounded-md p-1.5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
              >
                <input
                  type="radio"
                  name={`${id}-rating`}
                  value={star}
                  checked={rating === star}
                  onChange={() => {
                    setRating(star);
                    setError(null);
                  }}
                  className="sr-only"
                />
                <StarIcon
                  aria-hidden
                  className={cn(
                    "size-8 transition-colors",
                    rating !== null && star <= rating ? "fill-warning text-warning" : "text-muted-foreground",
                  )}
                />
                <span className="sr-only">{getRatingLabel(star)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <Label htmlFor={commentId} className="type-label text-foreground">
            Tell us more (optional)
          </Label>
          <Textarea
            id={commentId}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={REVIEW_COMMENT_MAX}
            rows={3}
            aria-describedby={`${id}-count`}
          />
          <p id={`${id}-count`} className="type-caption self-end text-muted-foreground">
            {comment.length}/{REVIEW_COMMENT_MAX}
          </p>

          {suggestions.length > 0 && (
            <div className="flex flex-col gap-2">
              <p id={`${id}-chips`} className="type-caption text-muted-foreground">
                Tap to add to your comment
              </p>
              <ul aria-labelledby={`${id}-chips`} className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => {
                  const added = hasSuggestion(comment, suggestion);
                  return (
                    <li key={suggestion}>
                      <Button
                        type="button"
                        variant="outline"
                        aria-pressed={added}
                        onClick={() => setComment((current) => addSuggestion(current, suggestion))}
                        className={cn("type-body-sm h-auto min-h-11 rounded-full px-3 py-2 whitespace-normal", added && "border-primary")}
                      >
                        {added ? <CheckIcon data-icon="inline-start" aria-hidden /> : <PlusIcon data-icon="inline-start" aria-hidden />}
                        {suggestion}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {error && (
          <p id={`${id}-error`} role="alert" className="type-body-sm text-error">
            {error}
          </p>
        )}

        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Sending…" : "Submit"}
        </Button>
      </form>
    </section>
  );
}
