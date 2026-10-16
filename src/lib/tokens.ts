import { createHash, randomBytes } from "node:crypto";

import type { OrderStage, StoreStatus } from "@/generated/prisma/enums";

import type { PaymentState } from "./orders";

// Private-link tokens (staff invitations now, order tracking links later):
// 256 random bits, written as 43 base64url characters. Only the SHA-256 hash
// is stored; the raw token exists in the link alone and is never logged.

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// True when the text could be a token we issued; anything else is refused
// without a database lookup.
export function isWellFormedToken(text: string): boolean {
  return TOKEN_PATTERN.test(text);
}

// ───────────── Tracking-link validity ─────────────

// The one rule for whether an order's tracking link works, checked in this
// order: a Deactivated store shows nothing, an open order works, a closed one
// works for 30 days after it was completed or cancelled, and one the store
// still owes a refund on works until the refund is settled. When the link was
// issued (trackingTokenIssuedAt) never matters.

export const TRACKING_LINK_DAYS = 30;
const TRACKING_LINK_MS = TRACKING_LINK_DAYS * 24 * 60 * 60 * 1000;

export type TrackingLinkStatus = "VALID" | "STORE_DEACTIVATED" | "EXPIRED";

export interface TrackingLinkOrder {
  storeStatus: StoreStatus;
  stage: OrderStage;
  completedAt: Date | null;
  cancelledAt: Date | null;
  // getBalance(order).state
  paymentState: PaymentState;
}

export function getTrackingLinkStatus(order: TrackingLinkOrder, now: Date): TrackingLinkStatus {
  if (order.storeStatus === "DEACTIVATED") return "STORE_DEACTIVATED";
  const closedAt = order.stage === "COMPLETED" ? order.completedAt : order.stage === "CANCELLED" ? order.cancelledAt : undefined;
  if (closedAt === undefined) return "VALID";
  if (closedAt !== null && now.getTime() - closedAt.getTime() < TRACKING_LINK_MS) return "VALID";
  if (order.paymentState === "REFUND_OWED") return "VALID";
  return "EXPIRED";
}
