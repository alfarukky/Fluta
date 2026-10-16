"use server";

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/logger";
import { recordId } from "@/schemas/orders";
import { requireStoreMember } from "@/server/auth/session";
import { moveDelivery, type DeliveryMoveError } from "@/server/services/deliveries";
import { ORDER_NOT_FOUND_MESSAGE } from "@/server/services/order-stages";
import type { DeliveryMove } from "@/types/deliveries";

// The Deliveries view's three moves, one action per button. These, and the
// Deliveries page, are the only workspace code that lets riders in
// ({ allowRider: true }); owners and staff may use them too. The store, user,
// and role come from the membership; the order ID from the client is acted
// on only if it is this store's pickup order at the stage the button expects.
// Never the general stage-change action (src/actions/order-stages.ts).

export type DeliveryActionResult =
  | { ok: true; message: string }
  | { ok: false; code: DeliveryMoveError | "NOT_ALLOWED_FOR_STORE" | "CHANGE_FAILED"; message: string };

const SUCCESS: Record<DeliveryMove, string> = {
  PICK_UP: "Marked picked up",
  SEND_OUT: "Out for delivery",
  DELIVER: "Marked delivered",
};

export async function markPickedUp(orderId: unknown): Promise<DeliveryActionResult> {
  return runDeliveryMove(orderId, "PICK_UP");
}

export async function sendOutForDelivery(orderId: unknown): Promise<DeliveryActionResult> {
  return runDeliveryMove(orderId, "SEND_OUT");
}

export async function markDelivered(orderId: unknown): Promise<DeliveryActionResult> {
  return runDeliveryMove(orderId, "DELIVER");
}

async function runDeliveryMove(orderId: unknown, move: DeliveryMove): Promise<DeliveryActionResult> {
  const member = await requireStoreMember({ allowRider: true });
  if (!member.allowed) return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: "You can't update this store's orders." };
  if (!member.access.canWorkOnExistingOrders) {
    return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: "This store can't work on orders right now." };
  }

  // A malformed order ID is treated exactly like another store's order.
  const id = recordId.safeParse(orderId);
  if (!id.success) return { ok: false, code: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };

  try {
    const result = await moveDelivery(
      { storeId: member.store.id, userId: member.user.id, role: member.membership.role },
      id.data,
      move,
      new Date(),
    );
    if (!result.ok) return { ok: false, code: result.error, message: result.message };

    revalidatePath("/deliveries");
    revalidatePath("/orders", "layout");
    return { ok: true, message: SUCCESS[move] };
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
    logger.error(
      `[deliveries] a delivery move for store ${member.store.id} failed:`,
      `${error instanceof Error ? error.name : "unknown error"}${code}`,
    );
    return { ok: false, code: "CHANGE_FAILED", message: "We couldn't update this order. Please try again." };
  }
}
