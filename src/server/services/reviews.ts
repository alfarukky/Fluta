import "server-only";

import { formatOrderNumber } from "@/lib/orders";
import { formatAverageRating } from "@/lib/reviews";
import { formatDateTime } from "@/lib/time";
import { hashToken, isWellFormedToken } from "@/lib/tokens";
import { encodeReviewListCursor, type ReviewListCursor, type ReviewListFilters, type SubmitReviewInput } from "@/schemas/reviews";
import { createReviewForToken, getReviewStats, listReviews, type ReviewListRecord, type ReviewOrderRecord, type ReviewStats } from "@/server/data/reviews";
import { getReviewRefusal } from "@/server/domain/reviews";
import type { ReviewListPage, ReviewListRow, ReviewSummary } from "@/types/reviews";

import { TRACKING_MESSAGES } from "./tracking";

// Customer reviews (Feature 19b): the customer leaving one through their
// order's private link, and the workspace's Reviews page. Private to the
// store: nothing here is ever shown publicly.

// ───────────── Leaving a review (the customer) ─────────────

export const REVIEW_MESSAGES = {
  thanks: "Thank you for your review",
  notCompleted: "This order can't be reviewed right now.",
  windowEnded: "Reviews for this order closed 7 days after it was completed.",
} as const;

// `rating`: the saved review's stars, for the thank-you card (null when a
// simultaneous submit saved first and its stars weren't read).
export type SubmitReviewResult = { ok: true; message: string; rating: number | null } | { ok: false; message: string };

// The token is the only credential: it is hashed and looked up exactly, and
// the review takes that order's store. Only a completed order, within 7 days
// of completion, at a store that isn't Deactivated. A second submit (or two
// at once) never creates a second review: it gets the same thank-you.
export async function submitReview(token: string, input: SubmitReviewInput, now: Date): Promise<SubmitReviewResult> {
  if (!isWellFormedToken(token)) return { ok: false, message: TRACKING_MESSAGES.invalid };

  const outcome = await createReviewForToken(hashToken(token), input, decideReview(now), now);
  switch (outcome.status) {
    case "CREATED":
    case "ALREADY_REVIEWED":
      return { ok: true, message: REVIEW_MESSAGES.thanks, rating: outcome.rating };
    case "NOT_FOUND":
      return { ok: false, message: TRACKING_MESSAGES.invalid };
    case "REFUSED":
      return { ok: false, message: outcome.refusal };
  }
}

// The usual link rules, then the review's own. A completed order within 7
// days of completion is always within its link's 30 days, so only the
// store's status can stop the link itself.
function decideReview(now: Date) {
  return (order: ReviewOrderRecord): string | null => {
    if (order.storeStatus === "DEACTIVATED") return TRACKING_MESSAGES.unavailable;
    switch (getReviewRefusal(order, now)) {
      case null:
      case "ALREADY_REVIEWED":
        return null;
      case "NOT_COMPLETED":
        return REVIEW_MESSAGES.notCompleted;
      case "WINDOW_ENDED":
        return REVIEW_MESSAGES.windowEnded;
    }
  };
}

// ───────────── The Reviews page (owners and staff) ─────────────

export const REVIEW_LIST_PAGE_SIZE = 25;

// The averages' recent period: exactly 30 × 24 hours.
const RECENT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface ReviewListStore {
  id: string;
  orderPrefix: string;
  timeZone: string;
}

// One page of reviews, newest first: one query whatever its size.
export async function getReviewListPage(
  store: ReviewListStore,
  filters: ReviewListFilters,
  after: ReviewListCursor | null = null,
): Promise<ReviewListPage> {
  const { reviews, hasMore } = await listReviews(store.id, { rating: filters.rating, ...(after && { after }) }, REVIEW_LIST_PAGE_SIZE);
  const last = reviews.at(-1);
  return {
    rows: reviews.map((review) => toListRow(review, store)),
    nextCursor: hasMore && last ? encodeReviewListCursor(last) : null,
  };
}

function toListRow(review: ReviewListRecord, store: ReviewListStore): ReviewListRow {
  return {
    id: review.id,
    orderId: review.orderId,
    displayNumber: formatOrderNumber(store, review.order.orderNumber),
    customerName: review.order.customer.name,
    rating: review.rating,
    comment: review.comment,
    date: formatDateTime(review.createdAt, store.timeZone),
  };
}

export interface ReviewsPageData {
  page: ReviewListPage;
  // Every review, whatever the star filter.
  recent: ReviewSummary;
  allTime: ReviewSummary;
}

export async function getReviewsPageData(store: ReviewListStore, filters: ReviewListFilters, now: Date): Promise<ReviewsPageData> {
  const [page, stats] = await Promise.all([
    getReviewListPage(store, filters),
    getReviewStats(store.id, new Date(now.getTime() - RECENT_PERIOD_MS)),
  ]);
  return { page, recent: toSummary(stats.recent), allTime: toSummary(stats.allTime) };
}

function toSummary(stats: ReviewStats): ReviewSummary {
  return { count: stats.count, average: formatAverageRating(stats.average) };
}
