import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { getPrisma } from "./client";

// Everything a receipt is built from, scoped to the member's store: another
// store's order matches nothing, exactly like a missing one. Money comes only
// from the permanent records (the approved revision, payments, refunds). The
// order's own lines are read for item names and quantities only, for a
// deposit paid before any price is approved. References, notes, fees, staff,
// and the customer's address are never read; the phone only to be masked.
const RECEIPT_ORDER_SELECT = {
  orderNumber: true,
  stage: true,
  channel: true,
  payLater: true,
  fulfilmentType: true,
  createdAt: true,
  store: {
    select: {
      name: true,
      addressText: true,
      phone: true,
      logoKey: true,
      timeZone: true,
      orderPrefix: true,
    },
  },
  customer: { select: { name: true, phone: true } },
  lines: {
    where: { lineType: "SERVICE" },
    select: {
      id: true,
      description: true,
      quantity: true,
      estimatedQuantity: true,
    },
    orderBy: { id: "asc" },
  },
  approvedQuote: {
    select: { total: true, fulfilmentCharge: true, linesSnapshot: true },
  },
  quoteRevisions: {
    select: { version: true, status: true, approvedAt: true, declinedAt: true },
  },
  payments: {
    select: {
      id: true,
      amount: true,
      method: true,
      status: true,
      voidedAt: true,
      confirmedAt: true,
      createdAt: true,
    },
  },
  refunds: {
    select: {
      id: true,
      amount: true,
      method: true,
      voidedAt: true,
      paidAt: true,
    },
  },
} as const satisfies Prisma.OrderSelect;

export type ReceiptOrderRecord = Prisma.OrderGetPayload<{
  select: typeof RECEIPT_ORDER_SELECT;
}>;

export async function findReceiptOrder(storeId: string, orderId: string): Promise<ReceiptOrderRecord | null> {
  return getPrisma().order.findUnique({
    where: { storeId_id: { storeId, id: orderId } },
    select: RECEIPT_ORDER_SELECT,
  });
}
