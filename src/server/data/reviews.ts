import "server-only";

import type { OrderStage, Prisma, StoreStatus } from "@/generated/prisma/client";
import { MESSAGE_TEMPLATES } from "@/lib/messages";
import type { ReviewListCursor } from "@/schemas/reviews";
import { REVIEW_REMINDER_DELAY_MS, REVIEW_WINDOW_MS } from "@/server/domain/reviews";

import { getPrisma } from "./client";
import { isUniqueViolation } from "./errors";
import { addStaffNotification } from "./staff-notifications";

// Customer reviews (Feature 19b). The customer's side finds its order only by
// the SHA-256 hash of the link's token, and the review takes the store from
// that order, never from the request. The workspace side always passes the
// member's storeId, and every query filters by it.

// Neon round trips are slow from here.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

// ───────────── Saving a review (the customer) ─────────────

export interface ReviewOrderRecord {
  id: string;
  storeId: string;
  stage: OrderStage;
  completedAt: Date | null;
  storeStatus: StoreStatus;
  hasReview: boolean;
}

export type CreateReviewOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  // A review already exists (a second submit, or two at the same moment):
  // its stars, when known.
  | { status: "ALREADY_REVIEWED"; rating: number | null }
  | { status: "CREATED"; reviewId: string; rating: number };

// Saves the review for the token's order, and its staff notification, in one
// transaction. The order row is locked first, so an owner reopening the order
// at the same moment either goes first (the review is refused) or waits until
// the review is saved. `decide` returns why the order can't be reviewed, or
// null. The unique rule on orderId keeps it to one review per order, even
// when two submits pass the check at the same moment.
export async function createReviewForToken<T>(
  tokenHash: string,
  input: { rating: number; comment: string | null },
  decide: (order: ReviewOrderRecord) => T | null,
  now: Date,
): Promise<CreateReviewOutcome<T>> {
  try {
    return await getPrisma().$transaction(async (tx): Promise<CreateReviewOutcome<T>> => {
      const rows = await tx.$queryRaw<{ id: string; storeId: string; stage: OrderStage; completedAt: Date | null; storeStatus: StoreStatus }[]>`
        SELECT o."id", o."storeId", o."stage", o."completedAt", s."status" AS "storeStatus"
        FROM "Order" o
        JOIN "Store" s ON s."id" = o."storeId"
        WHERE o."trackingTokenHash" = ${tokenHash}
        FOR UPDATE OF o`;
      const row = rows[0];
      if (!row) return { status: "NOT_FOUND" };

      const existing = await tx.review.findUnique({
        where: { storeId_orderId: { storeId: row.storeId, orderId: row.id } },
        select: { rating: true },
      });
      const order: ReviewOrderRecord = { ...row, hasReview: existing !== null };
      const refusal = decide(order);
      if (refusal !== null) return { status: "REFUSED", refusal };
      if (existing) return { status: "ALREADY_REVIEWED", rating: existing.rating };

      const review = await tx.review.create({
        data: { storeId: order.storeId, orderId: order.id, rating: input.rating, comment: input.comment, createdAt: now },
        select: { id: true, rating: true },
      });
      await addStaffNotification(tx, { storeId: order.storeId, orderId: order.id, type: "REVIEW_RECEIVED", sourceId: review.id });
      return { status: "CREATED", reviewId: review.id, rating: review.rating };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "ALREADY_REVIEWED", rating: null };
    throw error;
  }
}

// ───────────── The Reviews page (owners and staff) ─────────────

const LIST_ROW_SELECT = {
  id: true,
  orderId: true,
  rating: true,
  comment: true,
  createdAt: true,
  // The customer's current name, read from the order (no copy is stored).
  // Never their phone or address.
  order: { select: { orderNumber: true, customer: { select: { name: true } } } },
} as const satisfies Prisma.ReviewSelect;

export type ReviewListRecord = Prisma.ReviewGetPayload<{ select: typeof LIST_ROW_SELECT }>;

export interface ReviewListQuery {
  rating: number | null;
  after?: ReviewListCursor;
}

// Newest first, one page at a time.
export async function listReviews(
  storeId: string,
  query: ReviewListQuery,
  pageSize: number,
): Promise<{ reviews: ReviewListRecord[]; hasMore: boolean }> {
  const after = query.after;
  const reviews = await getPrisma().review.findMany({
    where: {
      storeId,
      ...(query.rating !== null && { rating: query.rating }),
      ...(after && { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }),
    },
    select: LIST_ROW_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
  });
  return { reviews: reviews.slice(0, pageSize), hasMore: reviews.length > pageSize };
}

export interface ReviewStats {
  count: number;
  // Null when there are none.
  average: number | null;
}

// The average and number of reviews since `since`, and for all time, in one query.
export async function getReviewStats(storeId: string, since: Date): Promise<{ recent: ReviewStats; allTime: ReviewStats }> {
  const rows = await getPrisma().$queryRaw<
    { count: number; average: number | null; recentCount: number; recentAverage: number | null }[]
  >`
    SELECT
      count(*)::int AS "count",
      avg("rating")::float8 AS "average",
      (count(*) FILTER (WHERE "createdAt" >= ${since}))::int AS "recentCount",
      (avg("rating") FILTER (WHERE "createdAt" >= ${since}))::float8 AS "recentAverage"
    FROM "Review"
    WHERE "storeId" = ${storeId}`;
  const row = rows[0];
  return {
    recent: { count: row?.recentCount ?? 0, average: row?.recentAverage ?? null },
    allTime: { count: row?.count ?? 0, average: row?.average ?? null },
  };
}

// ───────────── The reminder email (the scheduled job) ─────────────

export interface ReminderCandidate {
  id: string;
  storeId: string;
  stage: OrderStage;
  completedAt: Date | null;
  store: { status: StoreStatus; timeZone: string };
}

// Orders that may be due a review reminder, across all stores: completed
// more than 3 hours and less than 7 days ago, with no review and no reminder
// yet, at a store that isn't Deactivated with email copies on, for a customer
// with an email.
// The daytime window (each store's own time zone) is checked by the caller.
export async function findReviewReminderCandidates(now: Date, limit: number): Promise<ReminderCandidate[]> {
  return getPrisma().order.findMany({
    where: {
      stage: "COMPLETED",
      completedAt: {
        gt: new Date(now.getTime() - REVIEW_WINDOW_MS),
        lte: new Date(now.getTime() - REVIEW_REMINDER_DELAY_MS),
      },
      review: { is: null },
      messageEvents: { none: { template: MESSAGE_TEMPLATES.reviewRequest } },
      store: { status: { not: "DEACTIVATED" }, emailCopiesEnabled: true },
      customer: { email: { not: null } },
    },
    select: { id: true, storeId: true, stage: true, completedAt: true, store: { select: { status: true, timeZone: true } } },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
}

// The order as the last check before sending a reminder needs it, or null.
export async function findReminderOrder(storeId: string, orderId: string): Promise<ReviewOrderRecord | null> {
  const order = await getPrisma().order.findUnique({
    where: { storeId_id: { storeId, id: orderId } },
    select: { id: true, storeId: true, stage: true, completedAt: true, store: { select: { status: true } }, review: { select: { id: true } } },
  });
  if (!order) return null;
  return {
    id: order.id,
    storeId: order.storeId,
    stage: order.stage,
    completedAt: order.completedAt,
    storeStatus: order.store.status,
    hasReview: order.review !== null,
  };
}
