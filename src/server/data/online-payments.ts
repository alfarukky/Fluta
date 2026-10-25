import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { MISMATCH_CODES } from "@/lib/online-payment";

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
  // getBalance: Payment required applies only to online bookings paid at booking.
  channel: true,
  payLater: true,
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

// ───────────── Confirming (plan 6.8) ─────────────

export const ONLINE_PAYMENT_AUDIT_ACTIONS = {
  confirmed: "ONLINE_PAYMENT_CONFIRMED",
  needsReview: "ONLINE_PAYMENT_NEEDS_REVIEW",
} as const;

const PAYMENT_AUDIT_TARGET = "Payment";

// A payment failed with a mismatch code is never confirmed by a retried
// webhook or verify.
const NEVER_CONFIRMED_CODES: string[] = [...MISMATCH_CODES];

// PENDING, or FAILED for a reason that isn't a mismatch (an abandoned or
// expired attempt, a failed initialize): Paystack's later success still
// counts, because the money really arrived. `notIn` alone would skip a NULL
// code (SQL NOT IN never matches NULL), so NULL is listed too.
function confirmableWhere(storeId: string, paymentId: string): Prisma.PaymentWhereInput {
  return {
    storeId,
    id: paymentId,
    source: "ONLINE",
    OR: [
      { status: "PENDING" },
      { status: "FAILED", OR: [{ failureCode: null }, { failureCode: { notIn: NEVER_CONFIRMED_CODES } }] },
    ],
  };
}

// What confirming needs to know about a payment, found by Fluta's own
// reference (unique across all stores). Everything after this is scoped by
// the payment's own storeId.
export async function findOnlinePaymentByReference(reference: string) {
  return getPrisma().payment.findUnique({
    where: { paystackReference: reference },
    select: {
      id: true,
      storeId: true,
      orderId: true,
      amount: true,
      source: true,
      status: true,
      failureCode: true,
      paystackReference: true,
      store: { select: { name: true, paystackSubaccountCode: true, orderPrefix: true } },
      order: { select: { orderNumber: true } },
    },
  });
}

export type OnlinePaymentRecord = NonNullable<Awaited<ReturnType<typeof findOnlinePaymentByReference>>>;

// Why money arrived when nothing was due: the timeline says so, so staff can
// see why a refund is owed (plan 6.9).
export type ReceivedAfter = "CANCELLED" | "PAID" | null;

export type ConfirmPaymentOutcome = { status: "CONFIRMED"; receivedAfter: ReceivedAfter } | { status: "ALREADY_HANDLED" };

// One conditional update, in a transaction with the order locked: two
// webhooks, or a webhook and a verify, can't both confirm it. Writes the
// timeline's AuditEvent in the same transaction.
export async function confirmOnlinePayment(
  storeId: string,
  paymentId: string,
  confirmation: { confirmedAt: Date; paystackFeeAmount: number | null },
  now: Date,
): Promise<ConfirmPaymentOutcome> {
  return getPrisma().$transaction(async (tx): Promise<ConfirmPaymentOutcome> => {
    const payment = await tx.payment.findFirst({
      where: { storeId, id: paymentId },
      select: { orderId: true, amount: true, paystackReference: true },
    });
    if (!payment) return { status: "ALREADY_HANDLED" };
    await lockOrder(tx, storeId, payment.orderId);

    const { count } = await tx.payment.updateMany({
      where: confirmableWhere(storeId, paymentId),
      data: { status: "CONFIRMED", confirmedAt: confirmation.confirmedAt, paystackFeeAmount: confirmation.paystackFeeAmount },
    });
    if (count === 0) return { status: "ALREADY_HANDLED" };

    // The order with this payment counted: was anything due before it?
    const order = await tx.order.findUniqueOrThrow({
      where: { storeId_id: { storeId, id: payment.orderId } },
      select: {
        stage: true,
        approvedQuote: { select: { total: true } },
        payments: { where: { status: "CONFIRMED", voidedAt: null }, select: { amount: true } },
        refunds: { where: { voidedAt: null }, select: { amount: true } },
      },
    });
    const receivedAfter = getReceivedAfter(order, payment.amount);

    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "SYSTEM",
        action: ONLINE_PAYMENT_AUDIT_ACTIONS.confirmed,
        targetType: PAYMENT_AUDIT_TARGET,
        targetId: paymentId,
        metadata: { orderId: payment.orderId, reference: payment.paystackReference, amount: payment.amount, receivedAfter },
        createdAt: now,
      },
    });
    return { status: "CONFIRMED", receivedAfter };
  }, TRANSACTION_OPTIONS);
}

function getReceivedAfter(
  order: { stage: string; approvedQuote: { total: number } | null; payments: { amount: number }[]; refunds: { amount: number }[] },
  amount: number,
): ReceivedAfter {
  if (order.stage === "CANCELLED") return "CANCELLED";
  if (!order.approvedQuote) return null;
  const paidBefore = order.payments.reduce((sum, p) => sum + p.amount, 0) - amount;
  const refunded = order.refunds.reduce((sum, r) => sum + r.amount, 0);
  return order.approvedQuote.total - paidBefore + refunded <= 0 ? "PAID" : null;
}

// A successful Paystack payment that doesn't match: FAILED with its code,
// recorded once (the same condition as confirming, so a payment already
// confirmed or already under review is left alone), with an AuditEvent in
// the same transaction. True when this call recorded it.
export async function recordOnlinePaymentMismatch(
  storeId: string,
  paymentId: string,
  mismatch: { code: string; expectedAmount: number; receivedAmount: number; reference: string },
  now: Date,
): Promise<boolean> {
  return getPrisma().$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: confirmableWhere(storeId, paymentId),
      data: { status: "FAILED", failureCode: mismatch.code },
    });
    if (count === 0) return false;
    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "SYSTEM",
        action: ONLINE_PAYMENT_AUDIT_ACTIONS.needsReview,
        targetType: PAYMENT_AUDIT_TARGET,
        targetId: paymentId,
        metadata: mismatch,
        createdAt: now,
      },
    });
    return true;
  }, TRANSACTION_OPTIONS);
}

// For the order timeline: why each confirmed online payment arrived when
// nothing was due, by payment ID.
export async function findOnlinePaymentNotes(storeId: string, paymentIds: readonly string[]): Promise<Map<string, ReceivedAfter>> {
  if (paymentIds.length === 0) return new Map();
  const events = await getPrisma().auditEvent.findMany({
    where: { storeId, action: ONLINE_PAYMENT_AUDIT_ACTIONS.confirmed, targetType: PAYMENT_AUDIT_TARGET, targetId: { in: [...paymentIds] } },
    select: { targetId: true, metadata: true },
  });
  const notes = new Map<string, ReceivedAfter>();
  for (const event of events) {
    const after = (event.metadata as { receivedAfter?: unknown } | null)?.receivedAfter;
    if (event.targetId) notes.set(event.targetId, after === "CANCELLED" || after === "PAID" ? after : null);
  }
  return notes;
}

// ───────────── The reconciliation job (plan 7.1) ─────────────

// Online attempts PENDING for longer than `after`, started since `since`,
// oldest first. Across all stores: the job is Fluta's, not a store's.
export async function findStalePendingPayments(before: Date, since: Date, take: number) {
  return getPrisma().payment.findMany({
    where: { source: "ONLINE", status: "PENDING", createdAt: { lt: before, gte: since } },
    select: { storeId: true, paystackReference: true },
    orderBy: { createdAt: "asc" },
    take,
  });
}

// Attempts still PENDING from before `cutoff` become FAILED (a late webhook
// can still confirm them). Returns how many.
export async function expireOldPendingPayments(cutoff: Date, failureCode: string): Promise<number> {
  const { count } = await getPrisma().payment.updateMany({
    where: { source: "ONLINE", status: "PENDING", createdAt: { lt: cutoff } },
    data: { status: "FAILED", failureCode },
  });
  return count;
}
