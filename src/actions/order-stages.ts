"use server";

import { revalidatePath } from "next/cache";

import type { OrderStage } from "@/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { ORDER_STAGE_LABELS } from "@/lib/orders";
import { changeOrderStageSchema } from "@/schemas/orders";
import { requireStoreMember } from "@/server/auth/session";
import { changeStage, ORDER_NOT_FOUND_MESSAGE, type StageChangeError } from "@/server/services/order-stages";

// Moving an order between stages from the order detail page. Owners and staff
// may, whenever the store can work on existing orders. The store, user, and
// role come from the membership; owner-only moves are checked by
// canTransition with that role, never only in the UI.

export type ChangeOrderStageErrorCode = StageChangeError | "NOT_ALLOWED_FOR_STORE" | "INVALID_INPUT" | "CHANGE_FAILED";

export type ChangeOrderStageResult =
  | { ok: true; message: string }
  | { ok: false; code: ChangeOrderStageErrorCode; message: string };

export async function changeOrderStage(request: unknown): Promise<ChangeOrderStageResult> {
  const member = await requireStoreMember();
  if (!member.allowed) return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: "You can't change this store's orders." };
  if (!member.access.canWorkOnExistingOrders) {
    return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: "This store can't work on orders right now." };
  }

  const parsed = changeOrderStageSchema.safeParse(request);
  if (!parsed.success) {
    const noteIssue = parsed.error.issues.find((issue) => issue.path[0] === "note");
    if (noteIssue) return { ok: false, code: "INVALID_INPUT", message: noteIssue.message };
    // A malformed order ID is treated exactly like another store's order.
    if (parsed.error.issues.some((issue) => issue.path[0] === "orderId")) {
      return { ok: false, code: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };
    }
    return { ok: false, code: "INVALID_INPUT", message: "This change isn't available for this order." };
  }

  try {
    const result = await changeStage(
      { storeId: member.store.id, userId: member.user.id, role: member.membership.role },
      parsed.data,
      new Date(),
    );
    if (!result.ok) return { ok: false, code: result.error, message: result.message };

    revalidatePath("/orders", "layout");
    return { ok: true, message: getSuccessMessage(result.from, result.to) };
  } catch (error) {
    logger.error(`[order-stages] changing a stage for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, code: "CHANGE_FAILED", message: "We couldn't update this order. Please try again." };
  }
}

function getSuccessMessage(from: OrderStage, to: OrderStage): string {
  if (to === "CANCELLED") return "Order cancelled";
  if (from === "COMPLETED") return `Order reopened at ${ORDER_STAGE_LABELS[to]}`;
  return `Order moved to ${ORDER_STAGE_LABELS[to]}`;
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
