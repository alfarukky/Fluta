import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { getPrisma } from "./client";
import { lockOrder } from "./payments";

// Online (Paystack) payment attempts. Every attempt is a PENDING Payment
// saved before Paystack is called, under Fluta's own reference (plan 6.4).
// storeId and orderId always come from the order the tracking token opened,
// and are part of every where clause. Confirming a payment is Phase 4.

// Neon round trips are slow from here.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

// What canPayOnline needs, as the order is now.
const PAYABLE_ORDER_SELECT = {
  stage: true,
  completedAt: true,
  cancelledAt: true,
  customerId: true,
  approvedQuote: { select: { total: true } },
  payments: { select: { amount: true, status: true, voidedAt: true, source: true, createdAt: true } },
  refunds: { select: { amount: true, voidedAt: true } },
  quoteRevisions: { select: { version: true, status: true, approvedAt: true, declinedAt: true } },
  store: { select: { status: true, paystackSubaccountCode: true, onlineFeeBps: true, currency: true } },
} as const satisfies Prisma.OrderSelect;

export type PayableOrderRecord = Prisma.OrderGetPayload<{ select: typeof PAYABLE_ORDER_SELECT }>;

export interface NewOnlinePayment {
  amount: number;
  paystackReference: string;
  payerEmail: string;
  flutaFeeBps: number;
  flutaFeeAmount: number;
}

export type PendingPaymentOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  | { status: "CREATED"; paymentId: string; payment: NewOnlinePayment; subaccountCode: string; currency: string };

// In one transaction: locks the order, asks `decide` (the caller's rules)
// with the order as it is now, and saves a PENDING online payment. The
// payer's email is also saved on the customer, only if they have none yet
// (Feature 13's never-overwrite rule).
export async function insertPendingOnlinePayment<T>(
  storeId: string,
  orderId: string,
  decide: (order: PayableOrderRecord) => { ok: true; payment: NewOnlinePayment } | { ok: false; refusal: T },
  now: Date,
): Promise<PendingPaymentOutcome<T>> {
  return getPrisma().$transaction(async (tx): Promise<PendingPaymentOutcome<T>> => {
    if (!(await lockOrder(tx, storeId, orderId))) return { status: "NOT_FOUND" };
    const order = await tx.order.findUniqueOrThrow({ where: { storeId_id: { storeId, id: orderId } }, select: PAYABLE_ORDER_SELECT });
    const decision = decide(order);
    if (!decision.ok) return { status: "REFUSED", refusal: decision.refusal };
    // decide only allows a connected store.
    const subaccountCode = order.store.paystackSubaccountCode;
    if (subaccountCode === null) throw new Error("An online payment needs a connected store.");

    const { id } = await tx.payment.create({
      data: { storeId, orderId, source: "ONLINE", method: "PAYSTACK", status: "PENDING", ...decision.payment, createdAt: now },
      select: { id: true },
    });
    await tx.customer.updateMany({
      where: { storeId, id: order.customerId, email: null },
      data: { email: decision.payment.payerEmail },
    });
    return { status: "CREATED", paymentId: id, payment: decision.payment, subaccountCode, currency: order.store.currency };
  }, TRANSACTION_OPTIONS);
}

// An attempt Paystack couldn't start: it never counts. Only a PENDING
// attempt changes, so a late confirmation (Phase 4) is never undone here.
export async function markOnlinePaymentFailed(storeId: string, paymentId: string, failureCode: string): Promise<void> {
  await getPrisma().payment.updateMany({
    where: { storeId, id: paymentId, source: "ONLINE", status: "PENDING" },
    data: { status: "FAILED", failureCode: failureCode.slice(0, 60) },
  });
}
