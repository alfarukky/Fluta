"use server";

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/logger";
import { confirmPickupSchema, suggestPickupSchema } from "@/schemas/pickup-times";
import { requireStoreMember } from "@/server/auth/session";
import { confirmPickupTime as confirm, suggestPickup, type PickupTimeResult } from "@/server/services/pickup-times";
import { ORDER_NOT_FOUND_MESSAGE } from "@/server/services/quotes";

// Staff confirming a pickup order's requested time, or suggesting another,
// from the order detail page. Owners and staff may, whenever the store can
// work on existing orders. The store, user, and role come from the
// membership; the order ID is only used when it belongs to that store.

export type PickupTimeActionResult =
  | PickupTimeResult
  | { ok: false; message: string; fieldErrors: Record<string, string> };

async function requirePickupWorker() {
  const member = await requireStoreMember();
  if (!member.allowed) return { ok: false as const, result: { ok: false as const, message: "You can't change this store's orders." } };
  if (!member.access.canWorkOnExistingOrders) {
    return { ok: false as const, result: { ok: false as const, message: "This store can't work on orders right now." } };
  }
  return {
    ok: true as const,
    actor: {
      storeId: member.store.id,
      userId: member.user.id,
      role: member.membership.role,
      timeZone: member.store.timeZone,
    },
  };
}

export async function confirmPickupTime(request: unknown): Promise<PickupTimeActionResult> {
  const access = await requirePickupWorker();
  if (!access.ok) return access.result;
  const parsed = confirmPickupSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: ORDER_NOT_FOUND_MESSAGE };

  try {
    const result = await confirm(access.actor, parsed.data.orderId, new Date());
    if (result.ok) revalidatePath("/orders", "layout");
    return result;
  } catch (error) {
    logger.error(`[pickup-times] confirming a pickup time for store ${access.actor.storeId} failed:`, describeError(error));
    return { ok: false, message: "We couldn't confirm the pickup time. Please try again." };
  }
}

export async function suggestPickupTime(request: unknown): Promise<PickupTimeActionResult> {
  const access = await requirePickupWorker();
  if (!access.ok) return access.result;
  const parsed = suggestPickupSchema.safeParse(request);
  if (!parsed.success) {
    // A malformed order ID is treated exactly like another store's order.
    if (parsed.error.issues.some((issue) => issue.path[0] === "orderId")) return { ok: false, message: ORDER_NOT_FOUND_MESSAGE };
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.map(String).join(".") || "form"] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields and try again.", fieldErrors };
  }

  try {
    const result = await suggestPickup(access.actor, parsed.data, new Date());
    if (result.ok) revalidatePath("/orders", "layout");
    return result;
  } catch (error) {
    logger.error(`[pickup-times] suggesting a pickup time for store ${access.actor.storeId} failed:`, describeError(error));
    return { ok: false, message: "We couldn't save the suggested time. Please try again." };
  }
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
