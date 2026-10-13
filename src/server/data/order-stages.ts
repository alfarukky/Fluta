import "server-only";

import type { OrderStage, Prisma } from "@/generated/prisma/client";

import { getPrisma } from "./client";

// Changing an order's stage. storeId always comes from the caller's
// membership and is part of every where clause, so another store's order
// matches nothing.

// Neon round trips are slow from here.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

const STAGE_RECORD_SELECT = {
  stage: true,
  fulfilmentType: true,
  stageBeforeQuote: true,
  pickupWindowStatus: true,
  approvedQuoteId: true,
  quoteRevisions: { select: { version: true, status: true, approvedAt: true, declinedAt: true } },
  statusEvents: { select: { id: true, fromStage: true, toStage: true, createdAt: true } },
} as const satisfies Prisma.OrderSelect;

export type OrderStageRecord = Prisma.OrderGetPayload<{ select: typeof STAGE_RECORD_SELECT }>;

export interface StageChange {
  from: OrderStage;
  to: OrderStage;
  note: string | null;
  actorUserId: string;
  // COMPLETED sets completedAt; reopening a completed order clears it.
  completedAt: "set" | "clear" | "keep";
  // Cancelling sets cancelledAt and cancelNote.
  cancel: boolean;
}

export type StageChangeOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  | { status: "CONFLICT" }
  | { status: "CHANGED" };

// In one transaction: reads the order as it is now, asks `decide` (the
// caller's rules) for the change, moves the stage only if it is still
// `change.from`, and writes the status event. If someone else moved the
// order first, the conditional update matches nothing and nothing is saved.
export async function changeOrderStage<T>(
  storeId: string,
  orderId: string,
  decide: (order: OrderStageRecord) => { ok: true; change: StageChange } | { ok: false; refusal: T },
  now: Date,
): Promise<StageChangeOutcome<T>> {
  return getPrisma().$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { storeId_id: { storeId, id: orderId } },
      select: STAGE_RECORD_SELECT,
    });
    if (!order) return { status: "NOT_FOUND" };

    const decision = decide(order);
    if (!decision.ok) return { status: "REFUSED", refusal: decision.refusal };
    const { change } = decision;

    const { count } = await tx.order.updateMany({
      where: { storeId, id: orderId, stage: change.from },
      data: {
        stage: change.to,
        ...(change.completedAt === "set" && { completedAt: now }),
        ...(change.completedAt === "clear" && { completedAt: null }),
        ...(change.cancel && { cancelledAt: now, cancelNote: change.note }),
      },
    });
    if (count === 0) return { status: "CONFLICT" };

    await tx.statusEvent.create({
      data: {
        storeId,
        orderId,
        fromStage: change.from,
        toStage: change.to,
        actorType: "STAFF",
        actorUserId: change.actorUserId,
        note: change.note,
        createdAt: now,
      },
    });
    return { status: "CHANGED" };
  }, TRANSACTION_OPTIONS);
}
