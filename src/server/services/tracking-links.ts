import "server-only";

import { generateToken, getTrackingLinkStatus, hashToken } from "@/lib/tokens";
import { getTrackingUrl } from "@/lib/tracking-link";
import { reissueTrackingToken, type LinkOrderRecord } from "@/server/data/tracking";
import { getBalance } from "@/server/domain/balance";

import { ORDER_NOT_FOUND_MESSAGE } from "./quotes";

// Staff "Get tracking link": a fresh token for the order, so the old link
// stops working at once. The new link is returned once, to show with Copy,
// and never stored or logged. storeId and the user come from the caller's
// membership (see src/actions/tracking-links.ts); a store whose members can
// work on orders is never Deactivated.

export const LINK_EXPIRED_MESSAGE =
  "This order closed more than 30 days ago with nothing owed, so a tracking link would no longer work.";

// Offered only when the new link would work.
export function canIssueTrackingLink(order: LinkOrderRecord, now: Date): boolean {
  const status = getTrackingLinkStatus(
    {
      storeStatus: "ACTIVE",
      stage: order.stage,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
      paymentState: getBalance(order).state,
    },
    now,
  );
  return status === "VALID";
}

export type IssueTrackingLinkResult = { ok: true; url: string; message: string } | { ok: false; message: string };

export async function issueTrackingLink(
  actor: { storeId: string; userId: string },
  orderId: string,
  now: Date,
): Promise<IssueTrackingLinkResult> {
  const token = generateToken();
  const outcome = await reissueTrackingToken(
    actor.storeId,
    orderId,
    (order) => (canIssueTrackingLink(order, now) ? null : LINK_EXPIRED_MESSAGE),
    hashToken(token),
    actor.userId,
    now,
  );
  switch (outcome.status) {
    case "ISSUED":
      return { ok: true, url: getTrackingUrl(token), message: "New tracking link ready. The old link no longer works." };
    case "NOT_FOUND":
      return { ok: false, message: ORDER_NOT_FOUND_MESSAGE };
    case "REFUSED":
      return { ok: false, message: outcome.refusal };
  }
}
