"use server";

import { logger } from "@/lib/logger";
import { acceptPickupSchema, priceDecisionSchema, trackingTokenSchema } from "@/schemas/tracking";
import {
  acceptSuggestedPickup,
  decidePriceUpdate as decide,
  TRACKING_MESSAGES,
  type CustomerActionResult,
} from "@/server/services/tracking";

// The customer's actions on their tracking page (/o/{token}). No sign-in: the
// token is the credential, and the service checks it (and the link's
// validity) again on every call. The raw token is never logged.

export type TrackingActionResult = CustomerActionResult;

const FAILED: TrackingActionResult = { ok: false, message: "Something went wrong. Please try again." };

// Approve a price update, or decline it with an optional message to the store.
export async function decidePriceUpdate(token: unknown, request: unknown): Promise<TrackingActionResult> {
  const parsedToken = trackingTokenSchema.safeParse(token);
  if (!parsedToken.success) return { ok: false, message: TRACKING_MESSAGES.invalid };
  const parsed = priceDecisionSchema.safeParse(request);
  if (!parsed.success) {
    const messageIssue = parsed.error.issues.find((issue) => issue.path[0] === "message");
    return { ok: false, message: messageIssue?.message ?? TRACKING_MESSAGES.priceNotCurrent };
  }

  try {
    const { revisionId, decision } = parsed.data;
    const message = parsed.data.decision === "DECLINE" ? parsed.data.message : null;
    return await decide(parsedToken.data, { revisionId, decision, message }, new Date());
  } catch (error) {
    logger.error("[tracking] a price decision failed:", describeError(error));
    return FAILED;
  }
}

// Accept the pickup time the store suggested.
export async function acceptPickupTime(token: unknown, request: unknown): Promise<TrackingActionResult> {
  const parsedToken = trackingTokenSchema.safeParse(token);
  if (!parsedToken.success) return { ok: false, message: TRACKING_MESSAGES.invalid };
  const parsed = acceptPickupSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: TRACKING_MESSAGES.orderChanged };

  try {
    return await acceptSuggestedPickup(parsedToken.data, parsed.data.suggestionId, new Date());
  } catch (error) {
    logger.error("[tracking] accepting a pickup time failed:", describeError(error));
    return FAILED;
  }
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
