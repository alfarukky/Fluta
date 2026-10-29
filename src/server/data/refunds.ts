import "server-only";

import type { PaymentMethod, Prisma } from "@/generated/prisma/client";

import { getPrisma } from "./client";
import { lockOrder } from "./payments";

// A store's refunds: money the store paid back to a customer outside Fluta.
// storeId always comes from the caller's membership and is part of every
// where clause, so another store's order or refund matches nothing. Refunds
// are never edited or deleted, and never change a payment: they change only
// through the void fields.

// Neon round trips are slow from here.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export const REFUND_AUDIT_TARGET = "Refund";

export const REFUND_AUDIT_ACTIONS = {
  voided: "REFUND_VOIDED",
  // Voided and replaced by the correct refund, in one transaction.
  corrected: "REFUND_CORRECTED",
} as const;

// What getBalance needs, as the order is now. Refunds carry their ID so a
// refund being voided can be left out.
const BALANCE_SELECT = {
  stage: true,
  channel: true,
  payLater: true,
  approvedQuote: { select: { total: true } },
  payments: { select: { amount: true, status: true, voidedAt: true } },
  refunds: { select: { id: true, amount: true, voidedAt: true } },
} as const satisfies Prisma.OrderSelect;

export type RefundOrderRecord = Prisma.OrderGetPayload<{ select: typeof BALANCE_SELECT }>;

export interface RefundDetails {
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string;
}

export interface RecordedRefund {
  id: string;
  orderId: string;
  replacesRefundId: string | null;
}

const RECORDED_SELECT = { id: true, orderId: true, replacesRefundId: true } as const;

async function loadBalanceOrder(tx: Prisma.TransactionClient, storeId: string, orderId: string) {
  return tx.order.findUniqueOrThrow({ where: { storeId_id: { storeId, id: orderId } }, select: BALANCE_SELECT });
}

// ───────────── Recording ─────────────

export type RecordRefundOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  | { status: "RECORDED"; refund: RecordedRefund }
  // This request already recorded a refund (a double tap, a retry).
  | { status: "EXISTING"; refund: RecordedRefund };

export interface InsertRefundRequest {
  clientRequestId: string;
  actorUserId: string;
  details: RefundDetails;
}

// In one transaction: returns the refund this request already recorded, if
// any; otherwise locks the order (so refunds, payments, and voids on one
// order happen one at a time), asks `decide` (the caller's rules) with the
// balance as it is now, and records the refund, paid now.
//
// Throws Prisma's unique-constraint error (P2002) if the same request is
// recorded at the same moment by another transaction; the caller then
// returns that refund (findRefundByClientRequestId).
export async function insertRefund<T>(
  storeId: string,
  orderId: string,
  request: InsertRefundRequest,
  decide: (order: RefundOrderRecord) => { ok: true } | { ok: false; refusal: T },
  now: Date,
): Promise<RecordRefundOutcome<T>> {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.refund.findUnique({
      where: { storeId_clientRequestId: { storeId, clientRequestId: request.clientRequestId } },
      select: RECORDED_SELECT,
    });
    if (existing) return { status: "EXISTING", refund: existing };

    if (!(await lockOrder(tx, storeId, orderId))) return { status: "NOT_FOUND" };
    const decision = decide(await loadBalanceOrder(tx, storeId, orderId));
    if (!decision.ok) return { status: "REFUSED", refusal: decision.refusal };

    const refund = await tx.refund.create({
      data: {
        storeId,
        orderId,
        ...request.details,
        recordedByUserId: request.actorUserId,
        clientRequestId: request.clientRequestId,
        paidAt: now,
        createdAt: now,
      },
      select: RECORDED_SELECT,
    });
    return { status: "RECORDED", refund };
  }, TRANSACTION_OPTIONS);
}

export async function findRefundByClientRequestId(storeId: string, clientRequestId: string): Promise<RecordedRefund | null> {
  return getPrisma().refund.findUnique({
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
  voidedAt: true,
  voidedByUserId: true,
} as const satisfies Prisma.RefundSelect;

export type VoidRefundRecord = Prisma.RefundGetPayload<{ select: typeof VOID_RECORD_SELECT }>;

export interface VoidRefundRequest {
  refundId: string;
  actorUserId: string;
  reason: string;
  // The correct refund recorded in its place, with its own request ID.
  replacement: { clientRequestId: string; details: RefundDetails } | null;
}

export type RefundVoidDecisionResult<T> = { kind: "void" } | { kind: "alreadyVoided" } | { kind: "refused"; refusal: T };

export type VoidRefundOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  // Another refund already used this request ID (an expired form).
  | { status: "REQUEST_REUSED" }
  // Someone else changed the refund between the read and the update.
  | { status: "CONFLICT" }
  | { status: "VOIDED"; orderId: string; replacementId: string | null }
  // A retry: the void (and replacement) this request asked for already happened.
  | { status: "ALREADY_DONE"; orderId: string; replacementId: string | null };

// In one transaction: voids the refund (only if it isn't voided yet, in one
// conditional update), records the replacement if there is one, and writes
// the audit event. If any step fails, nothing is kept: the refund stays.
//
// `decide` gets the refund and the order's balance inputs as they are once
// the order is locked, without the refund being voided, so a replacement is
// judged against the amount owed after the void.
//
// Throws P2002 if a replacement with this request ID, or a second
// replacement for this refund, was saved by another transaction at the
// same moment.
export async function voidStoreRefund<T>(
  storeId: string,
  request: VoidRefundRequest,
  decide: (refund: VoidRefundRecord, order: RefundOrderRecord) => RefundVoidDecisionResult<T>,
  now: Date,
): Promise<VoidRefundOutcome<T>> {
  return getPrisma().$transaction(async (tx) => {
    const { refundId, replacement } = request;
    if (replacement) {
      const existing = await tx.refund.findUnique({
        where: { storeId_clientRequestId: { storeId, clientRequestId: replacement.clientRequestId } },
        select: RECORDED_SELECT,
      });
      if (existing) {
        if (existing.replacesRefundId !== refundId) return { status: "REQUEST_REUSED" };
        return { status: "ALREADY_DONE", orderId: existing.orderId, replacementId: existing.id };
      }
    }

    const found = await tx.refund.findFirst({ where: { storeId, id: refundId }, select: { orderId: true } });
    if (!found || !(await lockOrder(tx, storeId, found.orderId))) return { status: "NOT_FOUND" };

    // Read again now the order is locked: another void may have just finished.
    const refund = await tx.refund.findFirstOrThrow({ where: { storeId, id: refundId }, select: VOID_RECORD_SELECT });
    const order = await loadBalanceOrder(tx, storeId, refund.orderId);
    const others = { ...order, refunds: order.refunds.filter((other) => other.id !== refundId) };

    const decision = decide(refund, others);
    if (decision.kind === "refused") return { status: "REFUSED", refusal: decision.refusal };
    if (decision.kind === "alreadyVoided") return { status: "ALREADY_DONE", orderId: refund.orderId, replacementId: null };

    const { count } = await tx.refund.updateMany({
      where: { storeId, id: refundId, voidedAt: null },
      data: { voidedAt: now, voidedByUserId: request.actorUserId, voidReason: request.reason },
    });
    if (count === 0) return { status: "CONFLICT" };

    const created = replacement
      ? await tx.refund.create({
          data: {
            storeId,
            orderId: refund.orderId,
            ...replacement.details,
            recordedByUserId: request.actorUserId,
            clientRequestId: replacement.clientRequestId,
            replacesRefundId: refundId,
            paidAt: now,
            createdAt: now,
          },
          select: { id: true },
        })
      : null;

    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "STAFF",
        actorUserId: request.actorUserId,
        action: created ? REFUND_AUDIT_ACTIONS.corrected : REFUND_AUDIT_ACTIONS.voided,
        targetType: REFUND_AUDIT_TARGET,
        targetId: refundId,
        reason: request.reason,
        metadata: {
          orderId: refund.orderId,
          amount: refund.amount,
          method: refund.method,
          replacementRefundId: created?.id ?? null,
        },
        createdAt: now,
      },
    });
    return { status: "VOIDED", orderId: refund.orderId, replacementId: created?.id ?? null };
  }, TRANSACTION_OPTIONS);
}

// ───────────── Payments page: Refunds view ─────────────

const LIST_ROW_SELECT = {
  id: true,
  orderId: true,
  amount: true,
  method: true,
  recordedByUserId: true,
  paidAt: true,
  voidedAt: true,
  replacesRefundId: true,
  order: { select: { orderNumber: true, customer: { select: { name: true } } } },
} as const satisfies Prisma.RefundSelect;

export type RefundListRecord = Prisma.RefundGetPayload<{ select: typeof LIST_ROW_SELECT }>;

export interface RefundListQuery {
  paidFrom: Date;
  // The last row already shown: newest first, so the next page is older.
  after: { paidAt: Date; id: string } | null;
}

// One page of the store's refunds (voided ones too), newest first by when
// they were paid, and whether more follow. One query whatever the page size.
export async function listRefunds(
  storeId: string,
  query: RefundListQuery,
  pageSize: number,
): Promise<{ refunds: RefundListRecord[]; hasMore: boolean }> {
  const after = query.after;
  const refunds = await getPrisma().refund.findMany({
    where: {
      storeId,
      paidAt: { gte: query.paidFrom },
      ...(after && { OR: [{ paidAt: { lt: after.paidAt } }, { paidAt: after.paidAt, id: { lt: after.id } }] }),
    },
    select: LIST_ROW_SELECT,
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
  });
  return { refunds: refunds.slice(0, pageSize), hasMore: refunds.length > pageSize };
}

// Refunds paid since `from`. Voided refunds never count.
export async function sumPaidRefunds(storeId: string, from: Date): Promise<number> {
  const result = await getPrisma().refund.aggregate({
    where: { storeId, voidedAt: null, paidAt: { gte: from } },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}
