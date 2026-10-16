"use server";

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/logger";
import { issueTrackingLinkSchema } from "@/schemas/tracking";
import { requireStoreMember } from "@/server/auth/session";
import { ORDER_NOT_FOUND_MESSAGE } from "@/server/services/quotes";
import { issueTrackingLink as issue, type IssueTrackingLinkResult } from "@/server/services/tracking-links";

// Staff "Get tracking link" on the order detail page: a fresh link for the
// customer, shown once. Owners and staff may, whenever the store can work on
// existing orders. The store and user come from the membership.

export async function issueTrackingLink(request: unknown): Promise<IssueTrackingLinkResult> {
  const member = await requireStoreMember();
  if (!member.allowed) return { ok: false, message: "You can't change this store's orders." };
  if (!member.access.canWorkOnExistingOrders) return { ok: false, message: "This store can't work on orders right now." };

  const parsed = issueTrackingLinkSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: ORDER_NOT_FOUND_MESSAGE };

  try {
    const result = await issue({ storeId: member.store.id, userId: member.user.id }, parsed.data.orderId, new Date());
    if (result.ok) revalidatePath("/orders", "layout");
    return result;
  } catch (error) {
    logger.error(`[tracking-links] issuing a link for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, message: "We couldn't make a new link. Please try again." };
  }
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
