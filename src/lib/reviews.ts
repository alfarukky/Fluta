// Customer reviews (Feature 19b): the rules shared by the customer's review
// card, the server, and the workspace. A review is a star rating from 1 to 5
// with an optional comment, private to the store.

export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

export const REVIEW_COMMENT_MAX = 300;

export function isReviewRating(value: number): value is ReviewRating {
  return (REVIEW_RATINGS as readonly number[]).includes(value);
}

// ───────────── Suggestion chips ─────────────

// The only place the chip wording lives, so it can be changed later and
// counted in saved comments. The suggestions follow the stars chosen.
export const REVIEW_SUGGESTIONS = {
  good: ["Clothes came back fresh", "Pickup was on time", "Friendly service", "Great value"],
  middle: ["Good, but slow", "Some items need another wash", "Could communicate better"],
  poor: ["Pickup or delivery was late", "Items were damaged", "Clothes not properly cleaned", "Poor communication"],
} as const satisfies Record<string, readonly string[]>;

// What a chip adds between the existing text and itself.
export const SUGGESTION_SEPARATOR = " · ";

// None until stars are chosen: 4 or 5 good, 3 middle, 1 or 2 poor.
export function getReviewSuggestions(rating: number | null): readonly string[] {
  if (rating === null || !isReviewRating(rating)) return [];
  if (rating >= 4) return REVIEW_SUGGESTIONS.good;
  if (rating === 3) return REVIEW_SUGGESTIONS.middle;
  return REVIEW_SUGGESTIONS.poor;
}

// The comment's phrases: the parts between " · " (or punctuation and line
// breaks the customer typed), compared ignoring case and extra spaces.
function getPhrases(comment: string): string[] {
  return comment
    .split(/[·,.;!?\n]/)
    .map((phrase) => phrase.trim().replace(/\s+/g, " ").toLowerCase())
    .filter(Boolean);
}

// Whether the chip is already in the comment as its own phrase. Typed text
// that only contains it ("Great value for money") doesn't count.
export function hasSuggestion(comment: string, suggestion: string): boolean {
  return getPhrases(comment).includes(suggestion.trim().toLowerCase());
}

// The comment with the chip added after any existing text (" · " between).
// Unchanged when the chip is already there as its own phrase, or when the
// whole chip and its separator wouldn't fit: a chip is never cut short.
export function addSuggestion(comment: string, suggestion: string, max: number = REVIEW_COMMENT_MAX): string {
  if (hasSuggestion(comment, suggestion)) return comment;
  const existing = comment.trimEnd();
  const next = existing.trim() === "" ? suggestion : `${existing}${SUGGESTION_SEPARATOR}${suggestion}`;
  return next.length > max ? comment : next;
}

// ───────────── Showing a rating ─────────────

// "★★★★☆": filled stars for the rating, hollow for the rest.
export function formatStars(rating: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

// How much of one star (1 to 5) to fill for a rating, in tenths from 0 to 10.
// Averages are shown to one decimal place, so tenths are exact: 4.7 fills
// stars 1 to 4 and 7 tenths of star 5.
export function getStarFillTenths(rating: number, star: number): number {
  return Math.round(Math.min(Math.max(rating - (star - 1), 0), 1) * 10);
}

// "4 out of 5", for screen readers and the staff notification.
export function describeRating(rating: number): string {
  return `${rating} out of 5`;
}

// "1 star", "4 stars".
export function getRatingLabel(rating: number): string {
  return rating === 1 ? "1 star" : `${rating} stars`;
}

// An average to one decimal place ("4.3"), or null when there are no reviews.
export function formatAverageRating(average: number | null): string | null {
  return average === null ? null : (Math.round(average * 10) / 10).toFixed(1);
}
