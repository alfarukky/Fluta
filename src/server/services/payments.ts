import "server-only";

import type { StoreRole } from "@/generated/prisma/client";
import { formatNaira } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders";
import type { Overpayment } from "@/lib/payments";
import { formatDateTime } from "@/lib/time";
import {
  encodePaymentListCursor,
  PAYMENT_FORM_EXPIRED_MESSAGE,
  type PaymentListFilters,
  type RecordPaymentInput,
  type VoidPaymentInput,
} from "@/schemas/payments";
import { isUniqueViolation } from "@/server/data/errors";
import { findStaffNames } from "@/server/data/orders";
import {
  findPaymentByClientRequestId,
  insertStorePayment,
  listPayments,
  sumConfirmedPayments,
  voidStorePayment,
  type PaymentListRecord,
  type RecordPaymentOutcome,
  type StorePaymentDetails,
  type VoidPaymentOutcome,
} from "@/server/data/payments";
import {
  buildPaymentListQuery,
  decideStorePayment,
  decideVoid,
  getPeriodStart,
  PAYMENT_LIST_PAGE_SIZE,
  type VoidRefusalCode,
} from "@/server/domain/payments";
import type { PaymentListCursor, PaymentListPage, PaymentListRow, PaymentTotals } from "@/types/payments";

import { ORDER_CHANGED_MESSAGE, ORDER_NOT_FOUND_MESSAGE } from "./order-stages";

// Store-collected payments: recording, voiding, and the Payments page. The
// store and the user always come from the caller's membership (see
// src/actions/payments.ts); whether they may do this is the caller's check.

export interface PaymentActor {
  storeId: string;
  userId: string;
}

export type PaymentErrorCode =
  | "NOT_FOUND"
  | "ORDER_CANCELLED"
  | "OVERPAYMENT_UNCONFIRMED"
  | "REQUEST_REUSED"
  | "CONFLICT"
  | VoidRefusalCode;

// An overpayment the server found that staff haven't confirmed: the form
// shows the current balance and asks again.
export interface OverpaymentCheck extends Overpayment {
  balanceKobo: number;
}

export type PaymentChangeResult =
  | { ok: true; message: string }
  | { ok: false; code: PaymentErrorCode; message: string; overpayment?: OverpaymentCheck };

type Refusal = Extract<PaymentChangeResult, { ok: false }>;

export const PAYMENT_NOT_FOUND_MESSAGE = "Payment not found.";
const RECORDED_MESSAGE = "Payment recorded";

function toDetails(input: StorePaymentDetails): StorePaymentDetails {
  return { amount: input.amount, method: input.method, reference: input.reference, note: input.note };
}

function overpaymentRefusal(decision: ReturnType<typeof decideStorePayment>): Refusal | null {
  if (decision.allowed) return null;
  if (decision.code === "ORDER_CANCELLED") return { ok: false, code: decision.code, message: decision.reason };
  return {
    ok: false,
    code: decision.code,
    message: decision.reason,
    overpayment: { balanceKobo: decision.balanceKobo, ...decision.overpayment },
  };
}

export async function recordStorePayment(actor: PaymentActor, input: RecordPaymentInput, now: Date): Promise<PaymentChangeResult> {
  let outcome: RecordPaymentOutcome<Refusal>;
  try {
    outcome = await insertStorePayment<Refusal>(
      actor.storeId,
      input.orderId,
      { clientRequestId: input.clientRequestId, actorUserId: actor.userId, details: toDetails(input) },
      (order) => {
        const refusal = overpaymentRefusal(decideStorePayment(order, input.amount, input.confirmedExcess));
        return refusal ? { ok: false, refusal } : { ok: true };
      },
      now,
    );
  } catch (error) {
    // The same request at the same moment: the database's unique rule
    // refused a second payment, so return the first one.
    if (!isUniqueViolation(error)) throw error;
    const existing = await findPaymentByClientRequestId(actor.storeId, input.clientRequestId);
    if (!existing) throw error;
    outcome = { status: "EXISTING", payment: existing };
  }

  switch (outcome.status) {
    case "NOT_FOUND":
      return { ok: false, code: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };
    case "REFUSED":
      return outcome.refusal;
    case "EXISTING":
      // A request ID belongs to one payment on one order.
      if (outcome.payment.orderId !== input.orderId || outcome.payment.replacesPaymentId !== null) {
        return { ok: false, code: "REQUEST_REUSED", message: PAYMENT_FORM_EXPIRED_MESSAGE };
      }
      return { ok: true, message: RECORDED_MESSAGE };
    case "RECORDED":
      return { ok: true, message: RECORDED_MESSAGE };
  }
}

export async function voidPayment(actor: PaymentActor, input: VoidPaymentInput, now: Date): Promise<PaymentChangeResult> {
  const replacement =
    input.mode === "REPLACE" ? { clientRequestId: input.clientRequestId, details: toDetails(input) } : null;
  const doneMessage = replacement ? "Payment voided and correct payment recorded" : "Payment voided";

  let outcome: VoidPaymentOutcome<Refusal>;
  try {
    outcome = await voidStorePayment<Refusal>(
      actor.storeId,
      { paymentId: input.paymentId, actorUserId: actor.userId, reason: input.reason, replacement },
      (payment, order) => {
        const verdict = decideVoid(payment, actor.userId, replacement !== null);
        if (verdict.kind === "refused") {
          return { kind: "refused", refusal: { ok: false, code: verdict.code, message: verdict.reason } };
        }
        if (verdict.kind === "alreadyVoided" || input.mode !== "REPLACE") return verdict;
        const refusal = overpaymentRefusal(
          decideStorePayment(order, input.amount, input.confirmedExcess, { replacing: true }),
        );
        return refusal ? { kind: "refused", refusal } : verdict;
      },
      now,
    );
  } catch (error) {
    if (!isUniqueViolation(error) || !replacement) throw error;
    // Saved at the same moment by another request: this request's own
    // replacement is a success; anything else is someone else's change.
    const existing = await findPaymentByClientRequestId(actor.storeId, replacement.clientRequestId);
    outcome =
      existing?.replacesPaymentId === input.paymentId
        ? { status: "ALREADY_DONE", orderId: existing.orderId, replacementId: existing.id }
        : { status: "CONFLICT" };
  }

  switch (outcome.status) {
    case "NOT_FOUND":
      return { ok: false, code: "NOT_FOUND", message: PAYMENT_NOT_FOUND_MESSAGE };
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

// ───────────── Payments page ─────────────

export interface PaymentListStore {
  id: string;
  orderPrefix: string;
  timeZone: string;
}

export const ONLINE_PAYMENT_LABEL = "Online payment";

// One page of the list: a fixed number of queries whatever its size (the
// payments with their orders, then the staff names).
export async function getPaymentListPage(
  store: PaymentListStore,
  filters: PaymentListFilters,
  now: Date,
  after: PaymentListCursor | null = null,
): Promise<PaymentListPage> {
  const query = buildPaymentListQuery(filters, store.timeZone, now, after);
  const { payments, hasMore } = await listPayments(store.id, query, PAYMENT_LIST_PAGE_SIZE);
  const names = await findStaffNames(
    store.id,
    payments.flatMap((payment) => (payment.recordedByUserId ? [payment.recordedByUserId] : [])),
  );
  const last = payments.at(-1);
  return {
    rows: payments.map((payment) => toListRow(payment, store, names)),
    nextCursor: hasMore && last ? encodePaymentListCursor(last) : null,
  };
}

function toListRow(payment: PaymentListRecord, store: PaymentListStore, names: Map<string, string>): PaymentListRow {
  const recorder = payment.recordedByUserId ? names.get(payment.recordedByUserId) : undefined;
  return {
    id: payment.id,
    orderId: payment.orderId,
    displayNumber: formatOrderNumber(store, payment.order.orderNumber),
    customerName: payment.order.customer.name,
    confirmed: formatDateTime(payment.confirmedAt, store.timeZone),
    amount: formatNaira(payment.amount),
    method: payment.method,
    source: payment.source,
    recordedBy: payment.source === "ONLINE" ? ONLINE_PAYMENT_LABEL : (recorder ?? "Staff"),
    voided: payment.status === "VOIDED",
  };
}

export interface PaymentsPageData {
  page: PaymentListPage;
  // Owners only: financial figures. Null for staff.
  totals: PaymentTotals | null;
}

// The Payments page: the first page of the list, and for owners the totals
// for the chosen period, store-collected and online. Totals count confirmed
// payments only: a voided payment counts ₦0, even if received in the period.
export async function getPaymentsPageData(
  store: PaymentListStore,
  role: StoreRole,
  filters: PaymentListFilters,
  now: Date,
): Promise<PaymentsPageData> {
  const [page, totals] = await Promise.all([
    getPaymentListPage(store, filters, now),
    role === "OWNER" ? sumConfirmedPayments(store.id, getPeriodStart(filters.date, store.timeZone, now)) : null,
  ]);
  return { page, totals };
}
