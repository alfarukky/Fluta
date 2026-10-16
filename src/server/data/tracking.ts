import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { getPrisma } from "./client";
import { ORDER_AUDIT_TARGET } from "./quotes";

// Guest tracking links. A customer's link finds its order only by the SHA-256
// hash of its token, exactly (a unique column): no other lookup exists, by
// order number, phone, or part of a token. The order's own storeId then
// scopes everything else read for it. Never pass or store the raw token here.

// Neon round trips are slow from here.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export const TRACKING_AUDIT_ACTIONS = {
  linkIssued: "TRACKING_LINK_ISSUED",
  pickupSuggested: "PICKUP_TIME_SUGGESTED",
  // A pickup order stepped back to Booked: its time goes back to Requested.
  pickupReset: "PICKUP_TIME_RESET",
} as const;

// ───────────── The tracking page ─────────────

// Everything the tracking page shows, and nothing it doesn't: no address,
// customer name, internal note, customer note, or staff names. The full
// phone number is read only to be masked.
const TRACKED_ORDER_SELECT = {
  id: true,
  storeId: true,
  orderNumber: true,
  fulfilmentType: true,
  stage: true,
  stageBeforeQuote: true,
  approvedQuoteId: true,
  serviceAreaName: true,
  fulfilmentCharge: true,
  requestedPickupDate: true,
  requestedWindowStart: true,
  requestedWindowEnd: true,
  scheduledPickupDate: true,
  scheduledWindowStart: true,
  scheduledWindowEnd: true,
  pickupWindowStatus: true,
  completedAt: true,
  cancelledAt: true,
  store: {
    select: {
      name: true,
      slug: true,
      status: true,
      timeZone: true,
      orderPrefix: true,
      phone: true,
      description: true,
      logoKey: true,
      brandPrimaryColor: true,
      brandAccentColor: true,
    },
  },
  customer: { select: { phone: true } },
  lines: {
    select: {
      id: true,
      lineType: true,
      description: true,
      pricingType: true,
      requiresQuote: true,
      unitPrice: true,
      estimatedQuantity: true,
      quantity: true,
      lineTotal: true,
    },
    orderBy: [{ lineType: "asc" }, { id: "asc" }],
  },
  approvedQuote: { select: { id: true, total: true, linesSnapshot: true } },
  quoteRevisions: {
    select: {
      id: true,
      version: true,
      status: true,
      total: true,
      reason: true,
      linesSnapshot: true,
      approvedAt: true,
      declinedAt: true,
    },
    orderBy: { version: "desc" },
  },
  payments: { select: { amount: true, status: true, voidedAt: true } },
  refunds: { select: { amount: true, voidedAt: true } },
  statusEvents: { select: { id: true, fromStage: true, toStage: true, createdAt: true } },
} as const satisfies Prisma.OrderSelect;

export type TrackedOrderRecord = Prisma.OrderGetPayload<{ select: typeof TRACKED_ORDER_SELECT }>;

export async function findTrackedOrder(tokenHash: string): Promise<TrackedOrderRecord | null> {
  return getPrisma().order.findUnique({ where: { trackingTokenHash: tokenHash }, select: TRACKED_ORDER_SELECT });
}

// ───────────── Issuing a new link (staff) ─────────────

// What the rules need to decide whether a new link would work.
const LINK_ORDER_SELECT = {
  stage: true,
  completedAt: true,
  cancelledAt: true,
  approvedQuote: { select: { total: true } },
  payments: { select: { amount: true, status: true, voidedAt: true } },
  refunds: { select: { amount: true, voidedAt: true } },
} as const satisfies Prisma.OrderSelect;

export type LinkOrderRecord = Prisma.OrderGetPayload<{ select: typeof LINK_ORDER_SELECT }>;

export type ReissueOutcome<T> = { status: "NOT_FOUND" } | { status: "REFUSED"; refusal: T } | { status: "ISSUED" };

// Replaces the order's token hash in one update, so the old link stops
// working at once, and records who did it in an AuditEvent (never the token
// or its hash). Two at the same moment both succeed in turn: only the last
// stored link works.
export async function reissueTrackingToken<T>(
  storeId: string,
  orderId: string,
  decide: (order: LinkOrderRecord) => T | null,
  tokenHash: string,
  actorUserId: string,
  now: Date,
): Promise<ReissueOutcome<T>> {
  return getPrisma().$transaction(async (tx): Promise<ReissueOutcome<T>> => {
    // One query at a time on the transaction's connection (see readQuoteOrder).
    const order = await tx.order.findUnique({
      where: { storeId_id: { storeId, id: orderId } },
      select: { stage: true, completedAt: true, cancelledAt: true, approvedQuoteId: true },
    });
    if (!order) return { status: "NOT_FOUND" };
    const { approvedQuoteId, ...fields } = order;
    const record: LinkOrderRecord = {
      ...fields,
      approvedQuote: approvedQuoteId
        ? await tx.quoteRevision.findUnique({ where: { storeId_id: { storeId, id: approvedQuoteId } }, select: { total: true } })
        : null,
      payments: await tx.payment.findMany({ where: { storeId, orderId }, select: LINK_ORDER_SELECT.payments.select }),
      refunds: await tx.refund.findMany({ where: { storeId, orderId }, select: LINK_ORDER_SELECT.refunds.select }),
    };
    const refusal = decide(record);
    if (refusal !== null) return { status: "REFUSED", refusal };

    await tx.order.update({
      where: { storeId_id: { storeId, id: orderId } },
      data: { trackingTokenHash: tokenHash, trackingTokenIssuedAt: now },
    });
    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "STAFF",
        actorUserId,
        action: TRACKING_AUDIT_ACTIONS.linkIssued,
        targetType: ORDER_AUDIT_TARGET,
        targetId: orderId,
        createdAt: now,
      },
    });
    return { status: "ISSUED" };
  }, TRANSACTION_OPTIONS);
}

// A repeated online booking (a retry after a lost response): the first
// response's link was never seen, and only its hash was kept, so the order
// gets a new token. Online orders only. False when no such order exists.
export async function replaceBookingTrackingToken(
  storeId: string,
  clientRequestId: string,
  tokenHash: string,
  now: Date,
): Promise<boolean> {
  const { count } = await getPrisma().order.updateMany({
    where: { storeId, clientRequestId, channel: "ONLINE" },
    data: { trackingTokenHash: tokenHash, trackingTokenIssuedAt: now },
  });
  return count > 0;
}
