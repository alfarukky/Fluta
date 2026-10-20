"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { logger } from "@/lib/logger";
import {
  DEFAULT_PAYMENT_LIST_FILTERS,
  PAYMENT_FORM_EXPIRED_MESSAGE,
  paymentListCursorSchema,
  paymentListFiltersSchema,
  recordPaymentSchema,
  voidPaymentSchema,
} from "@/schemas/payments";
import { requireStoreMember } from "@/server/auth/session";
import { ORDER_NOT_FOUND_MESSAGE } from "@/server/services/order-stages";
import {
  getPaymentListPage,
  PAYMENT_NOT_FOUND_MESSAGE,
  recordStorePayment,
  voidPayment as voidStorePayment,
  type OverpaymentCheck,
  type PaymentErrorCode,
} from "@/server/services/payments";
import type { PaymentListRow } from "@/types/payments";

// Recording and voiding store-collected payments from the order detail page,
// and "Load more" on the Payments page. Each action checks the membership
// itself, and the store and user always come from it: an order or payment ID
// from another store matches nothing. Riders are refused (requireStoreMember
// without allowRider). Recording and voiding also need the store to be able
// to work on existing orders (getStoreAccess), like stage changes.

export type PaymentActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      message: string;
      code: PaymentErrorCode | "NOT_ALLOWED_FOR_STORE" | "INVALID_INPUT" | "SAVE_FAILED";
      fieldErrors?: Record<string, string>;
      // The server found more than the balance due that staff haven't confirmed.
      overpayment?: OverpaymentCheck;
    };

const STORE_LOCKED = "This store can't work on orders right now.";
const SAVE_FAILED = "We couldn't save this payment. Please try again.";
const FIELDS = ["amount", "method", "reference", "note", "reason"] as const;

export async function recordPayment(request: unknown): Promise<PaymentActionResult> {
  const member = await requireStoreMember();
  if (!member.allowed) {
    return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: "You can't record payments for this store." };
  }
  if (!member.access.canWorkOnExistingOrders) return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: STORE_LOCKED };

  const parsed = recordPaymentSchema.safeParse(request);
  if (!parsed.success) {
    // A malformed order ID is treated exactly like another store's order.
    if (hasIssue(parsed.error, "orderId")) return { ok: false, code: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };
    return invalid(parsed.error);
  }

  try {
    const result = await recordStorePayment({ storeId: member.store.id, userId: member.user.id }, parsed.data, new Date());
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    logger.error(`[payments] recording a payment for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, code: "SAVE_FAILED", message: SAVE_FAILED };
  }
}

// Owners only.
export async function voidPayment(request: unknown): Promise<PaymentActionResult> {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) {
    const message =
      member.reason === "ROLE_NOT_PERMITTED" ? "Only the store owner can void payments." : "You can't change this store's payments.";
    return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message };
  }
  if (!member.access.canWorkOnExistingOrders) return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: STORE_LOCKED };

  const parsed = voidPaymentSchema.safeParse(request);
  if (!parsed.success) {
    if (hasIssue(parsed.error, "paymentId")) return { ok: false, code: "NOT_FOUND", message: PAYMENT_NOT_FOUND_MESSAGE };
    return invalid(parsed.error);
  }

  try {
    const result = await voidStorePayment({ storeId: member.store.id, userId: member.user.id }, parsed.data, new Date());
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    logger.error(`[payments] voiding a payment for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, code: "SAVE_FAILED", message: "We couldn't void this payment. Please try again." };
  }
}

export type LoadMorePaymentsResult =
  | { ok: true; rows: PaymentListRow[]; nextCursor: string | null }
  | { ok: false; message: string };

export async function loadMorePayments(filters: unknown, cursor: unknown): Promise<LoadMorePaymentsResult> {
  const member = await requireStoreMember();
  if (!member.allowed) return { ok: false, message: "You can't view this store's payments." };

  const after = paymentListCursorSchema.safeParse(cursor);
  if (!after.success) return { ok: false, message: "We couldn't load more payments. Reload the page and try again." };

  // The page's own filters; anything malformed falls back to the defaults, as on the page.
  const parsed = paymentListFiltersSchema.safeParse(filters);
  const listFilters = parsed.success ? parsed.data : DEFAULT_PAYMENT_LIST_FILTERS;

  try {
    const page = await getPaymentListPage(member.store, listFilters, new Date(), after.data);
    return { ok: true, ...page };
  } catch (error) {
    logger.error(`[payments] loading more payments for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, message: "We couldn't load more payments. Try again." };
  }
}

function revalidate(): void {
  revalidatePath("/orders", "layout");
  revalidatePath("/payments");
}

function hasIssue(error: z.ZodError, field: string): boolean {
  return error.issues.some((issue) => issue.path[0] === field);
}

// Field messages under each field. An expired form (a bad request ID) or
// anything else unexpected gets one message.
function invalid(error: z.ZodError): PaymentActionResult {
  if (hasIssue(error, "clientRequestId")) return { ok: false, code: "INVALID_INPUT", message: PAYMENT_FORM_EXPIRED_MESSAGE };
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = FIELDS.find((name) => name === issue.path[0]);
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  if (Object.keys(fieldErrors).length === 0) {
    return { ok: false, code: "INVALID_INPUT", message: "This payment can't be saved. Close the form and try again." };
  }
  return { ok: false, code: "INVALID_INPUT", message: "Check the highlighted fields.", fieldErrors };
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
