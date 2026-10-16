import "server-only";

import type { OrderStage, StoreRole } from "@/generated/prisma/client";
import type { ChangeOrderStageInput } from "@/schemas/orders";
import { changeOrderStage, type StageChange } from "@/server/data/order-stages";
import {
  canTransition,
  findAvailableMove,
  getStageOrderState,
  toContext,
  type TransitionDenial,
} from "@/server/domain/order-stages";

// Moving an order between stages from the order detail page. storeId, the
// user, and their role always come from the caller's membership (see
// src/actions/order-stages.ts). Every move is checked again here, inside the
// transaction, against the order as it is in the database now.

export type StageChangeError = "NOT_FOUND" | "CONFLICT" | "NOT_OFFERED" | TransitionDenial;

export type StageChangeResult =
  | { ok: true; from: OrderStage; to: OrderStage }
  | { ok: false; error: StageChangeError; message: string };

export interface StageChangeActor {
  storeId: string;
  userId: string;
  role: StoreRole;
}

export const ORDER_NOT_FOUND_MESSAGE = "Order not found.";
export const ORDER_CHANGED_MESSAGE = "This order was just updated. Refresh to see the latest.";

type Refusal = { error: StageChangeError; message: string };

export async function changeStage(
  actor: StageChangeActor,
  request: ChangeOrderStageInput,
  now: Date,
): Promise<StageChangeResult> {
  const { from, to, note, collectedByCustomer } = request;

  const outcome = await changeOrderStage<Refusal>(
    actor.storeId,
    request.orderId,
    (order) => {
      if (order.stage !== from) return { ok: false, refusal: { error: "CONFLICT", message: ORDER_CHANGED_MESSAGE } };

      const state = getStageOrderState(order);
      const check = canTransition(from, to, toContext(state, actor.role, note, collectedByCustomer));
      // Only the moves this page offers; quotes and online bookings make
      // their own moves through their own actions.
      if (!findAvailableMove(state, actor.role, to, collectedByCustomer)) {
        const message = check.allowed ? "This change isn't available for this order." : check.reason;
        return { ok: false, refusal: { error: "NOT_OFFERED", message } };
      }
      if (!check.allowed) return { ok: false, refusal: { error: check.code, message: check.reason } };

      const change: StageChange = {
        from,
        to,
        note,
        actorUserId: actor.userId,
        completedAt: to === "COMPLETED" ? "set" : from === "COMPLETED" ? "clear" : "keep",
        cancel: to === "CANCELLED",
        resetPickupTime: order.fulfilmentType === "PICKUP_DELIVERY" && from === "PICKUP_SCHEDULED" && to === "BOOKED",
      };
      return { ok: true, change };
    },
    now,
  );

  switch (outcome.status) {
    case "CHANGED":
      return { ok: true, from, to };
    case "NOT_FOUND":
      return { ok: false, error: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };
    case "CONFLICT":
      return { ok: false, error: "CONFLICT", message: ORDER_CHANGED_MESSAGE };
    case "REFUSED":
      return { ok: false, ...outcome.refusal };
  }
}
