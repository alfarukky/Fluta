import "server-only";

import type { StoreRole } from "@/generated/prisma/client";
import { getLocalDateKey } from "@/lib/time";
import { findDeliveryOrders } from "@/server/data/deliveries";
import { changeOrderStage } from "@/server/data/order-stages";
import { buildDeliverySections } from "@/server/domain/deliveries";
import { canTransition, getStageOrderState, RIDER_MOVES, toContext } from "@/server/domain/order-stages";
import type { DeliveryMove, DeliverySections } from "@/types/deliveries";

import { ORDER_CHANGED_MESSAGE, ORDER_NOT_FOUND_MESSAGE } from "./order-stages";

// The Deliveries view (src/app/(staff)/(workspace)/deliveries) and its three
// moves. The store, user, and role always come from the caller's membership
// (src/actions/deliveries.ts).

// The only data function behind the view: the cards and nothing else.
export async function getDeliveries(
  store: { id: string; orderPrefix: string; timeZone: string },
  now: Date,
): Promise<DeliverySections> {
  const todayKey = getLocalDateKey(now, store.timeZone);
  return buildDeliverySections(await findDeliveryOrders(store.id, todayKey), todayKey, store);
}

// Each button's move. Typed against canTransition's rider allowlist, so a move
// can only be added here if riders are allowed to make it there too.
export const DELIVERY_MOVES = {
  PICK_UP: RIDER_MOVES[0],
  SEND_OUT: RIDER_MOVES[1],
  DELIVER: RIDER_MOVES[2],
} as const satisfies Record<DeliveryMove, (typeof RIDER_MOVES)[number]>;

export interface DeliveryActor {
  storeId: string;
  userId: string;
  role: StoreRole;
}

export type DeliveryMoveError = "NOT_FOUND" | "CONFLICT" | "NOT_ALLOWED";

export type DeliveryMoveResult = { ok: true } | { ok: false; error: DeliveryMoveError; message: string };

type Refusal = { error: DeliveryMoveError; message: string };

// In one transaction: the store's own pickup order, at exactly the stage this
// button expects, allowed by canTransition for this role; then the
// conditional update and the status event with the user as actor.
export async function moveDelivery(
  actor: DeliveryActor,
  orderId: string,
  move: DeliveryMove,
  now: Date,
): Promise<DeliveryMoveResult> {
  const { from, to } = DELIVERY_MOVES[move];

  const outcome = await changeOrderStage<Refusal>(
    actor.storeId,
    orderId,
    (order) => {
      // Drop-off orders aren't on the Deliveries view: treated as not found.
      if (order.fulfilmentType !== "PICKUP_DELIVERY") {
        return { ok: false, refusal: { error: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE } };
      }
      if (order.stage !== from) return { ok: false, refusal: { error: "CONFLICT", message: ORDER_CHANGED_MESSAGE } };

      const check = canTransition(from, to, toContext(getStageOrderState(order), actor.role, null, false));
      if (!check.allowed) return { ok: false, refusal: { error: "NOT_ALLOWED", message: check.reason } };

      return {
        ok: true,
        change: {
          from,
          to,
          note: null,
          actorUserId: actor.userId,
          completedAt: to === "COMPLETED" ? "set" : "keep",
          cancel: false,
          resetPickupTime: false,
        },
      };
    },
    now,
  );

  switch (outcome.status) {
    case "CHANGED":
      return { ok: true };
    case "NOT_FOUND":
      return { ok: false, error: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };
    case "CONFLICT":
      return { ok: false, error: "CONFLICT", message: ORDER_CHANGED_MESSAGE };
    case "REFUSED":
      return { ok: false, ...outcome.refusal };
  }
}
