import { z } from "zod";

import { isReviewRating, REVIEW_COMMENT_MAX, type ReviewRating } from "@/lib/reviews";

// ───────────── The customer's review ─────────────

// A star rating from 1 to 5 (required), and an optional plain-text comment:
// trimmed, at most 300 characters, empty saved as NULL. The token is checked
// separately (trackingTokenSchema); the store and order come from it.
export const submitReviewSchema = z.object({
  rating: z
    .number({ error: "Choose a star rating" })
    .int("Choose a star rating")
    .refine((value): value is ReviewRating => isReviewRating(value), "Choose a star rating"),
  comment: z
    .string()
    .trim()
    .max(REVIEW_COMMENT_MAX, `Your comment must be ${REVIEW_COMMENT_MAX} characters or fewer`)
    .nullish()
    .transform((value) => value || null),
});

export type SubmitReviewInput = z.output<typeof submitReviewSchema>;
export type SubmitReviewRequest = z.input<typeof submitReviewSchema>;

// ───────────── The Reviews page ─────────────

// ?rating=1…5 shows only reviews with that many stars. Anything else shows all.
export const reviewListFiltersSchema = z.object({
  rating: z.coerce
    .number()
    .int()
    .refine((value): value is ReviewRating => isReviewRating(value))
    .nullable()
    .catch(null),
});

export type ReviewListFilters = z.output<typeof reviewListFiltersSchema>;

export const DEFAULT_REVIEW_LIST_FILTERS: ReviewListFilters = { rating: null };

// Where "Load more" continues from: the last row's time and ID.
export const reviewListCursorSchema = z
  .string()
  .regex(/^\d{1,15}\.[A-Za-z0-9_-]{1,64}$/)
  .transform((text) => {
    const dot = text.indexOf(".");
    return { createdAt: new Date(Number(text.slice(0, dot))), id: text.slice(dot + 1) };
  });

export type ReviewListCursor = z.output<typeof reviewListCursorSchema>;

export function encodeReviewListCursor(cursor: { createdAt: Date; id: string }): string {
  return `${cursor.createdAt.getTime()}.${cursor.id}`;
}

// The page address for a set of filters ("" for none).
export function toReviewListSearch(filters: ReviewListFilters): string {
  return filters.rating === null ? "" : `?rating=${filters.rating}`;
}
