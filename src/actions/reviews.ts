"use server";

import { logger } from "@/lib/logger";
import { reviewListCursorSchema, reviewListFiltersSchema, submitReviewSchema, DEFAULT_REVIEW_LIST_FILTERS } from "@/schemas/reviews";
import { trackingTokenSchema } from "@/schemas/tracking";
import { requireStoreMember } from "@/server/auth/session";
import { getReviewListPage, submitReview as save, type SubmitReviewResult } from "@/server/services/reviews";
import { TRACKING_MESSAGES } from "@/server/services/tracking";
import type { ReviewListRow } from "@/types/reviews";

// Customer reviews (Feature 19b).

// ───────────── The customer (their order page, /o/{token}) ─────────────

// No sign-in: the token is the credential, and the service checks it (and
// the link's validity) again. The store and order come only from the token's
// order. The raw token and the comment are never logged.
export async function submitReview(token: unknown, request: unknown): Promise<SubmitReviewResult> {
  const parsedToken = trackingTokenSchema.safeParse(token);
  if (!parsedToken.success) return { ok: false, message: TRACKING_MESSAGES.invalid };
  const parsed = submitReviewSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Choose a star rating" };

  try {
    return await save(parsedToken.data, parsed.data, new Date());
  } catch (error) {
    logger.error("[reviews] saving a review failed:", describeError(error));
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

// ───────────── Owners and staff (the Reviews page) ─────────────

export type LoadMoreReviewsResult = { ok: true; rows: ReviewListRow[]; nextCursor: string | null } | { ok: false; message: string };

// Riders are refused, like the page itself. The store comes from the membership.
export async function loadMoreReviews(filters: unknown, cursor: unknown): Promise<LoadMoreReviewsResult> {
  const member = await requireStoreMember();
  if (!member.allowed) return { ok: false, message: "You can't view this store's reviews." };

  const after = reviewListCursorSchema.safeParse(cursor);
  if (!after.success) return { ok: false, message: "We couldn't load more reviews. Reload the page and try again." };
  // The page's own filters; anything malformed falls back to the defaults, as on the page.
  const parsed = reviewListFiltersSchema.safeParse(filters);

  try {
    const page = await getReviewListPage(member.store, parsed.success ? parsed.data : DEFAULT_REVIEW_LIST_FILTERS, after.data);
    return { ok: true, ...page };
  } catch (error) {
    logger.error(`[reviews] loading more reviews for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, message: "We couldn't load more reviews. Try again." };
  }
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
