import "server-only";

import { getLogoUrl } from "@/lib/logo-url";
import { formatOrderNumber } from "@/lib/orders";
import { RECEIPT_TEXT, hasActiveConfirmedPayment, receiptOrderNumber } from "@/lib/receipts";
import { orderIdSchema } from "@/schemas/orders";
import { requireStoreMember } from "@/server/auth/session";
import { findReceiptOrder } from "@/server/data/receipts";
import { buildReceipt } from "@/server/domain/receipts";
import type { Receipt } from "@/types/receipts";

type MemberAccess = Awaited<ReturnType<typeof requireStoreMember>>;

export type ReceiptResult =
  | {
      kind: "DENIED";
      reason: Extract<MemberAccess, { allowed: false }>["reason"];
    }
  | { kind: "NOT_FOUND" }
  // "Order number: FF-1024" and the message, nothing else.
  | { kind: "NO_PAYMENT"; orderNumber: string; message: string }
  | { kind: "RECEIPT"; receipt: Receipt };

// Everything the receipt page shows, and nothing it doesn't. Owners and staff
// only (riders are refused), and the store always comes from the membership:
// another store's order is "not found", exactly like a missing one. A receipt
// exists only once the order has an active confirmed payment, so a saved link
// whose only payment was later voided shows the message instead.
export async function getReceiptData(orderId: string): Promise<ReceiptResult> {
  const member = await requireStoreMember();
  if (!member.allowed) return { kind: "DENIED", reason: member.reason };

  const id = orderIdSchema.safeParse(orderId);
  if (!id.success) return { kind: "NOT_FOUND" };
  const order = await findReceiptOrder(member.store.id, id.data);
  if (!order) return { kind: "NOT_FOUND" };

  if (!hasActiveConfirmedPayment(order.payments)) {
    return {
      kind: "NO_PAYMENT",
      orderNumber: receiptOrderNumber(formatOrderNumber(order.store, order.orderNumber)),
      message: RECEIPT_TEXT.noPayment,
    };
  }
  return {
    kind: "RECEIPT",
    receipt: buildReceipt(order, getLogoUrl(order.store)),
  };
}
