import "server-only";

import type { PaymentMethod, PaymentSource, Prisma } from "@/generated/prisma/client";
import type { PaymentListQuery, PaymentTotals } from "@/types/payments";

import { getPrisma } from "./client";

// A store's payments. storeId always comes from the caller's membership and is
// part of every where clause, so another store's order or payment matches
// nothing. Payments are never edited or deleted: they change only through the
// void fields.

// Neon round trips are slow from here.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export const PAYMENT_AUDIT_TARGET = "Payment";

export const PAYMENT_AUDIT_ACTIONS = {
  voided: "PAYMENT_VOIDED",
  // Voided and replaced by the correct payment, in one transaction.
  corrected: "PAYMENT_CORRECTED",
} as const;

// What getBalance needs, as the order is now.
const BALANCE_SELECT = {
  stage: true,
  approvedQuote: { select: { total: true } },
  payments: { select: { id: true, amount: true, status: true, voidedAt: true } },
  refunds: { select: { amount: true, voidedAt: true } },
} as const satisfies Prisma.OrderSelect;

export type PaymentOrderRecord = Prisma.OrderGetPayload<{ select: typeof BALANCE_SELECT }>;

export interface StorePaymentDetails {
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
}

export interface RecordedPayment {
  id: string;
  orderId: string;
  replacesPaymentId: string | null;
}

const RECORDED_SELECT = { id: true, orderId: true, replacesPaymentId: true } as const;

// Locks the order's row until the transaction ends, so payments, voids, and
// stage changes on one order happen one at a time and each sees the balance
// left by the one before. False when the store has no such order.
export async function lockOrder(tx: Prisma.TransactionClient, storeId: string, orderId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Order" WHERE "storeId" = ${storeId} AND "id" = ${orderId} FOR UPDATE`;
  return rows.length > 0;
}

async function loadBalanceOrder(tx: Prisma.TransactionClient, storeId: string, orderId: string) {
  return tx.order.findUniqueOrThrow({ where: { storeId_id: { storeId, id: orderId } }, select: BALANCE_SELECT });
}

function storeCollected(storeId: string, orderId: string, actorUserId: string, details: StorePaymentDetails, now: Date) {
  return {
    storeId,
    orderId,
    ...details,
    source: "STORE_COLLECTED",
    status: "CONFIRMED",
    recordedByUserId: actorUserId,
    confirmedAt: now,
    createdAt: now,
  } as const;
}

// ───────────── Recording ─────────────

export type RecordPaymentOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  | { status: "RECORDED"; payment: RecordedPayment }
  // This request already recorded a payment (a double tap, a retry).
  | { status: "EXISTING"; payment: RecordedPayment };

export interface RecordPaymentRequest {
  clientRequestId: string;
  actorUserId: string;
  details: StorePaymentDetails;
}

// In one transaction: returns the payment this request already recorded, if
// any; otherwise locks the order, asks `decide` (the caller's rules) with the
// balance as it is now, and records a confirmed store-collected payment.
//
// Throws Prisma's unique-constraint error (P2002) if the same request is
// recorded at the same moment by another transaction; the caller then
// returns that payment (findPaymentByClientRequestId).
export async function insertStorePayment<T>(
  storeId: string,
  orderId: string,
  request: RecordPaymentRequest,
  decide: (order: PaymentOrderRecord) => { ok: true } | { ok: false; refusal: T },
  now: Date,
): Promise<RecordPaymentOutcome<T>> {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({
      where: { storeId_clientRequestId: { storeId, clientRequestId: request.clientRequestId } },
      select: RECORDED_SELECT,
    });
    if (existing) return { status: "EXISTING", payment: existing };

    if (!(await lockOrder(tx, storeId, orderId))) return { status: "NOT_FOUND" };
    const decision = decide(await loadBalanceOrder(tx, storeId, orderId));
    if (!decision.ok) return { status: "REFUSED", refusal: decision.refusal };

    const payment = await tx.payment.create({
      data: {
        ...storeCollected(storeId, orderId, request.actorUserId, request.details, now),
        clientRequestId: request.clientRequestId,
      },
      select: RECORDED_SELECT,
    });
    return { status: "RECORDED", payment };
  }, TRANSACTION_OPTIONS);
}

export async function findPaymentByClientRequestId(storeId: string, clientRequestId: string): Promise<RecordedPayment | null> {
  return getPrisma().payment.findUnique({
    where: { storeId_clientRequestId: { storeId, clientRequestId } },
    select: RECORDED_SELECT,
  });
}

// ───────────── Voiding ─────────────

const VOID_RECORD_SELECT = {
  id: true,
  orderId: true,
  amount: true,
  method: true,
  source: true,
  status: true,
  voidedByUserId: true,
} as const satisfies Prisma.PaymentSelect;

export type VoidPaymentRecord = Prisma.PaymentGetPayload<{ select: typeof VOID_RECORD_SELECT }>;

export interface VoidPaymentRequest {
  paymentId: string;
  actorUserId: string;
  reason: string;
  // The correct payment recorded in its place, with its own request ID.
  replacement: { clientRequestId: string; details: StorePaymentDetails } | null;
}

export type VoidDecisionResult<T> = { kind: "void" } | { kind: "alreadyVoided" } | { kind: "refused"; refusal: T };

export type VoidPaymentOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  // Another payment already used this request ID (an expired form).
  | { status: "REQUEST_REUSED" }
  // Someone else changed the payment between the read and the update.
  | { status: "CONFLICT" }
  | { status: "VOIDED"; orderId: string; replacementId: string | null }
  // A retry: the void (and replacement) this request asked for already happened.
  | { status: "ALREADY_DONE"; orderId: string; replacementId: string | null };

// In one transaction: voids the payment (only if it is still confirmed and
// store-collected, in one conditional update), records the replacement if
// there is one, and writes the audit event. If any step fails, nothing is
// kept: the payment stays confirmed.
//
// `decide` gets the payment and the order's balance inputs as they are once
// the order is locked, without the payment being voided (so a replacement is
// judged against the balance it will actually change).
//
// Throws P2002 if a replacement with this request ID, or a second
// replacement for this payment, was saved by another transaction at the
// same moment.
export async function voidStorePayment<T>(
  storeId: string,
  request: VoidPaymentRequest,
  decide: (payment: VoidPaymentRecord, order: PaymentOrderRecord) => VoidDecisionResult<T>,
  now: Date,
): Promise<VoidPaymentOutcome<T>> {
  return getPrisma().$transaction(async (tx) => {
    const { paymentId, replacement } = request;
    if (replacement) {
      const existing = await tx.payment.findUnique({
        where: { storeId_clientRequestId: { storeId, clientRequestId: replacement.clientRequestId } },
        select: RECORDED_SELECT,
      });
      if (existing) {
        if (existing.replacesPaymentId !== paymentId) return { status: "REQUEST_REUSED" };
        return { status: "ALREADY_DONE", orderId: existing.orderId, replacementId: existing.id };
      }
    }

    const found = await tx.payment.findFirst({ where: { storeId, id: paymentId }, select: { orderId: true } });
    if (!found || !(await lockOrder(tx, storeId, found.orderId))) return { status: "NOT_FOUND" };

    // Read again now the order is locked: another void may have just finished.
    const payment = await tx.payment.findFirstOrThrow({ where: { storeId, id: paymentId }, select: VOID_RECORD_SELECT });
    const order = await loadBalanceOrder(tx, storeId, payment.orderId);
    const others = { ...order, payments: order.payments.filter((other) => other.id !== paymentId) };

    const decision = decide(payment, others);
    if (decision.kind === "refused") return { status: "REFUSED", refusal: decision.refusal };
    if (decision.kind === "alreadyVoided") return { status: "ALREADY_DONE", orderId: payment.orderId, replacementId: null };

    const { count } = await tx.payment.updateMany({
      where: { storeId, id: paymentId, status: "CONFIRMED", source: "STORE_COLLECTED" },
      data: { status: "VOIDED", voidedAt: now, voidedByUserId: request.actorUserId, voidReason: request.reason },
    });
    if (count === 0) return { status: "CONFLICT" };

    const created = replacement
      ? await tx.payment.create({
          data: {
            ...storeCollected(storeId, payment.orderId, request.actorUserId, replacement.details, now),
            clientRequestId: replacement.clientRequestId,
            replacesPaymentId: paymentId,
          },
          select: { id: true },
        })
      : null;

    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "STAFF",
        actorUserId: request.actorUserId,
        action: created ? PAYMENT_AUDIT_ACTIONS.corrected : PAYMENT_AUDIT_ACTIONS.voided,
        targetType: PAYMENT_AUDIT_TARGET,
        targetId: paymentId,
        reason: request.reason,
        metadata: {
          orderId: payment.orderId,
          amount: payment.amount,
          method: payment.method,
          replacementPaymentId: created?.id ?? null,
        },
        createdAt: now,
      },
    });
    return { status: "VOIDED", orderId: payment.orderId, replacementId: created?.id ?? null };
  }, TRANSACTION_OPTIONS);
}

// ───────────── Payments page ─────────────

const LIST_ROW_SELECT = {
  id: true,
  orderId: true,
  amount: true,
  method: true,
  source: true,
  status: true,
  recordedByUserId: true,
  confirmedAt: true,
  order: { select: { orderNumber: true, customer: { select: { name: true } } } },
} as const satisfies Prisma.PaymentSelect;

export type PaymentListRecord = Prisma.PaymentGetPayload<{ select: typeof LIST_ROW_SELECT }> & { confirmedAt: Date };

// Only confirmed and voided payments: pending or failed online attempts
// belong on the order page. Every listed payment has a confirmation time
// (a voided one keeps it).
function listWhere(storeId: string, query: Omit<PaymentListQuery, "after">): Prisma.PaymentWhereInput {
  return {
    storeId,
    status: { in: ["CONFIRMED", "VOIDED"] },
    confirmedAt: { gte: query.confirmedFrom },
    ...(query.method && { method: query.method }),
    ...(query.source && { source: query.source }),
  };
}

// One page of the store's payments, newest confirmation first, and whether
// more follow. One query whatever the page size: the order and customer load
// with the payments.
export async function listPayments(
  storeId: string,
  query: PaymentListQuery,
  pageSize: number,
): Promise<{ payments: PaymentListRecord[]; hasMore: boolean }> {
  const after = query.after;
  const records = await getPrisma().payment.findMany({
    where: {
      ...listWhere(storeId, query),
      ...(after && {
        OR: [{ confirmedAt: { lt: after.confirmedAt } }, { confirmedAt: after.confirmedAt, id: { lt: after.id } }],
      }),
    },
    select: LIST_ROW_SELECT,
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
  });
  const payments = records.flatMap((record) => (record.confirmedAt ? [{ ...record, confirmedAt: record.confirmedAt }] : []));
  return { payments: payments.slice(0, pageSize), hasMore: payments.length > pageSize };
}

// Confirmed payments received since `from`, by source. Voided payments never
// count, even if they were received inside the period.
export async function sumConfirmedPayments(storeId: string, from: Date): Promise<PaymentTotals> {
  const groups = await getPrisma().payment.groupBy({
    by: ["source"],
    where: { storeId, status: "CONFIRMED", confirmedAt: { gte: from } },
    _sum: { amount: true },
  });
  const total = (source: PaymentSource) => groups.find((group) => group.source === source)?._sum.amount ?? 0;
  return { storeCollectedKobo: total("STORE_COLLECTED"), onlineKobo: total("ONLINE") };
}
