import "server-only";

import type { StoreRole } from "@/generated/prisma/client";
import { formatNaira } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders";
import { formatDateTime } from "@/lib/time";
import { PAYMENT_FORM_EXPIRED_MESSAGE, type PaymentDateRange } from "@/schemas/payments";
import { encodeRefundListCursor, type RecordRefundInput, type VoidRefundInput } from "@/schemas/refunds";
import { isUniqueViolation } from "@/server/data/errors";
import { findStaffNames } from "@/server/data/orders";
import {
  findRefundByClientRequestId,
  insertRefund,
  listRefunds,
  sumPaidRefunds,
  voidStoreRefund,
  type RecordRefundOutcome,
  type RefundDetails,
  type RefundListRecord,
  type VoidRefundOutcome,
} from "@/server/data/refunds";
import { getPeriodStart } from "@/server/domain/payments";
import { decideRefund, decideRefundVoid, REFUND_LIST_PAGE_SIZE, type RefundDecision } from "@/server/domain/refunds";
import type { RefundListPage, RefundListRow } from "@/types/refunds";

import { ORDER_CHANGED_MESSAGE, ORDER_NOT_FOUND_MESSAGE } from "./order-stages";
import type { PaymentActor, PaymentListStore } from "./payments";

// Refunds: recording, voiding, and the Payments page's Refunds view. The
// store and the user always come from the caller's membership (see
// src/actions/refunds.ts); whether they may do this is the caller's check.

export type RefundErrorCode = "NOT_FOUND" | "NOTHING_OWED" | "MORE_THAN_OWED" | "ALREADY_VOIDED" | "REQUEST_REUSED" | "CONFLICT";

export type RefundChangeResult =
  | { ok: true; message: string }
  // owedKobo: what is owed now, when the refund was refused for the amount.
  | { ok: false; code: RefundErrorCode; message: string; owedKobo?: number };

type Refusal = Extract<RefundChangeResult, { ok: false }>;

export const REFUND_NOT_FOUND_MESSAGE = "Refund not found.";
const RECORDED_MESSAGE = "Refund recorded";

function toDetails(input: RefundDetails): RefundDetails {
  return { amount: input.amount, method: input.method, reference: input.reference, note: input.note };
}

function toRefusal(decision: RefundDecision): Refusal | null {
  if (decision.allowed) return null;
  return { ok: false, code: decision.code, message: decision.reason, owedKobo: decision.owedKobo };
}

export async function recordRefund(actor: PaymentActor, input: RecordRefundInput, now: Date): Promise<RefundChangeResult> {
  let outcome: RecordRefundOutcome<Refusal>;
  try {
    outcome = await insertRefund<Refusal>(
      actor.storeId,
      input.orderId,
      { clientRequestId: input.clientRequestId, actorUserId: actor.userId, details: toDetails(input) },
      (order) => {
        const refusal = toRefusal(decideRefund(order, input.amount));
        return refusal ? { ok: false, refusal } : { ok: true };
      },
      now,
    );
  } catch (error) {
    // The same request at the same moment: the database's unique rule
    // refused a second refund, so return the first one.
    if (!isUniqueViolation(error)) throw error;
    const existing = await findRefundByClientRequestId(actor.storeId, input.clientRequestId);
    if (!existing) throw error;
    outcome = { status: "EXISTING", refund: existing };
  }

  switch (outcome.status) {
    case "NOT_FOUND":
      return { ok: false, code: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };
    case "REFUSED":
      return outcome.refusal;
    case "EXISTING":
      // A request ID belongs to one refund on one order.
      if (outcome.refund.orderId !== input.orderId || outcome.refund.replacesRefundId !== null) {
        return { ok: false, code: "REQUEST_REUSED", message: PAYMENT_FORM_EXPIRED_MESSAGE };
      }
      return { ok: true, message: RECORDED_MESSAGE };
    case "RECORDED":
      return { ok: true, message: RECORDED_MESSAGE };
  }
}

export async function voidRefund(actor: PaymentActor, input: VoidRefundInput, now: Date): Promise<RefundChangeResult> {
  const replacement =
    input.mode === "REPLACE" ? { clientRequestId: input.clientRequestId, details: toDetails(input) } : null;
  const doneMessage = replacement ? "Refund voided and correct refund recorded" : "Refund voided";

  let outcome: VoidRefundOutcome<Refusal>;
  try {
    outcome = await voidStoreRefund<Refusal>(
      actor.storeId,
      { refundId: input.refundId, actorUserId: actor.userId, reason: input.reason, replacement },
      (refund, order) => {
        const verdict = decideRefundVoid(refund, actor.userId, replacement !== null);
        if (verdict.kind === "refused") {
          return { kind: "refused", refusal: { ok: false, code: verdict.code, message: verdict.reason } };
        }
        if (verdict.kind === "alreadyVoided" || input.mode !== "REPLACE") return verdict;
        // Judged against the amount owed once this refund no longer counts.
        const refusal = toRefusal(decideRefund(order, input.amount));
        return refusal ? { kind: "refused", refusal } : verdict;
      },
      now,
    );
  } catch (error) {
    if (!isUniqueViolation(error) || !replacement) throw error;
    // Saved at the same moment by another request: this request's own
    // replacement is a success; anything else is someone else's change.
    const existing = await findRefundByClientRequestId(actor.storeId, replacement.clientRequestId);
    outcome =
      existing?.replacesRefundId === input.refundId
        ? { status: "ALREADY_DONE", orderId: existing.orderId, replacementId: existing.id }
        : { status: "CONFLICT" };
  }

  switch (outcome.status) {
    case "NOT_FOUND":
      return { ok: false, code: "NOT_FOUND", message: REFUND_NOT_FOUND_MESSAGE };
    case "REFUSED":
      return outcome.refusal;
    case "REQUEST_REUSED":
      return { ok: false, code: "REQUEST_REUSED", message: PAYMENT_FORM_EXPIRED_MESSAGE };
    case "CONFLICT":
      return { ok: false, code: "CONFLICT", message: ORDER_CHANGED_MESSAGE };
    case "VOIDED":
    case "ALREADY_DONE":
      return { ok: true, message: doneMessage };
  }
}

// ───────────── Payments page: Refunds view ─────────────

// One page of the Refunds view: a fixed number of queries whatever its size
// (the refunds with their orders, then the staff names).
export async function getRefundListPage(
  store: PaymentListStore,
  date: PaymentDateRange,
  now: Date,
  after: { paidAt: Date; id: string } | null = null,
): Promise<RefundListPage> {
  const paidFrom = getPeriodStart(date, store.timeZone, now);
  const { refunds, hasMore } = await listRefunds(store.id, { paidFrom, after }, REFUND_LIST_PAGE_SIZE);
  const names = await findStaffNames(
    store.id,
    refunds.map((refund) => refund.recordedByUserId),
  );
  const last = refunds.at(-1);
  return {
    rows: refunds.map((refund) => toListRow(refund, store, names)),
    nextCursor: hasMore && last ? encodeRefundListCursor(last) : null,
  };
}

function toListRow(refund: RefundListRecord, store: PaymentListStore, names: Map<string, string>): RefundListRow {
  return {
    id: refund.id,
    orderId: refund.orderId,
    displayNumber: formatOrderNumber(store, refund.order.orderNumber),
    customerName: refund.order.customer.name,
    paid: formatDateTime(refund.paidAt, store.timeZone),
    amount: formatNaira(refund.amount),
    method: refund.method,
    recordedBy: names.get(refund.recordedByUserId) ?? "Staff",
    voided: refund.voidedAt !== null,
    correction: refund.replacesRefundId !== null,
  };
}

export interface RefundsPageData {
  page: RefundListPage;
  // Owners only: refunds paid in the period, voided ones not counted. Null for staff.
  totalKobo: number | null;
}

export async function getRefundsPageData(
  store: PaymentListStore,
  role: StoreRole,
  date: PaymentDateRange,
  now: Date,
): Promise<RefundsPageData> {
  const [page, totalKobo] = await Promise.all([
    getRefundListPage(store, date, now),
    role === "OWNER" ? sumPaidRefunds(store.id, getPeriodStart(date, store.timeZone, now)) : null,
  ]);
  return { page, totalKobo };
}
