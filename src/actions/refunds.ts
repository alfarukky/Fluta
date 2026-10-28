"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { logger } from "@/lib/logger";
import { DEFAULT_PAYMENT_LIST_FILTERS, PAYMENT_FORM_EXPIRED_MESSAGE, paymentListFiltersSchema } from "@/schemas/payments";
import { recordRefundSchema, refundListCursorSchema, voidRefundSchema } from "@/schemas/refunds";
import { requireStoreMember } from "@/server/auth/session";
import { ORDER_NOT_FOUND_MESSAGE } from "@/server/services/order-stages";
import {
  getRefundListPage,
  recordRefund as recordStoreRefund,
  REFUND_NOT_FOUND_MESSAGE,
  voidRefund as voidStoreRefund,
  type RefundErrorCode,
} from "@/server/services/refunds";
import type { RefundListRow } from "@/types/refunds";

// Recording and voiding refunds from the order detail page, and "Load more"
// on the Payments page's Refunds view. Each action checks the membership
// itself, and the store and user always come from it: an order or refund ID
// from another store matches nothing. Riders are refused (requireStoreMember
// without allowRider). Recording and voiding also need the store to be able
// to work on existing orders (getStoreAccess).

export type RefundActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      message: string;
      code: RefundErrorCode | "NOT_ALLOWED_FOR_STORE" | "INVALID_INPUT" | "SAVE_FAILED";
      fieldErrors?: Record<string, string>;
      // What is owed now, when the refund was refused for its amount.
      owedKobo?: number;
    };

const STORE_LOCKED = "This store can't work on orders right now.";
const FIELDS = ["amount", "method", "reference", "note", "reason"] as const;

// Owners and staff.
export async function recordRefund(request: unknown): Promise<RefundActionResult> {
  const member = await requireStoreMember();
  if (!member.allowed) {
    return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: "You can't record refunds for this store." };
  }
  if (!member.access.canWorkOnExistingOrders) return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: STORE_LOCKED };

  const parsed = recordRefundSchema.safeParse(request);
  if (!parsed.success) {
    // A malformed order ID is treated exactly like another store's order.
    if (hasIssue(parsed.error, "orderId")) return { ok: false, code: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };
    return invalid(parsed.error);
  }

  try {
    const result = await recordStoreRefund({ storeId: member.store.id, userId: member.user.id }, parsed.data, new Date());
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    logger.error(`[refunds] recording a refund for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, code: "SAVE_FAILED", message: "We couldn't save this refund. Please try again." };
  }
}

// Owners only.
export async function voidRefund(request: unknown): Promise<RefundActionResult> {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) {
    const message =
      member.reason === "ROLE_NOT_PERMITTED" ? "Only the store owner can void refunds." : "You can't change this store's refunds.";
    return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message };
  }
  if (!member.access.canWorkOnExistingOrders) return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message: STORE_LOCKED };

  const parsed = voidRefundSchema.safeParse(request);
  if (!parsed.success) {
    if (hasIssue(parsed.error, "refundId")) return { ok: false, code: "NOT_FOUND", message: REFUND_NOT_FOUND_MESSAGE };
    return invalid(parsed.error);
  }

  try {
    const result = await voidStoreRefund({ storeId: member.store.id, userId: member.user.id }, parsed.data, new Date());
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    logger.error(`[refunds] voiding a refund for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, code: "SAVE_FAILED", message: "We couldn't void this refund. Please try again." };
  }
}

export type LoadMoreRefundsResult =
  | { ok: true; rows: RefundListRow[]; nextCursor: string | null }
  | { ok: false; message: string };

export async function loadMoreRefunds(filters: unknown, cursor: unknown): Promise<LoadMoreRefundsResult> {
  const member = await requireStoreMember();
  if (!member.allowed) return { ok: false, message: "You can't view this store's refunds." };

  const after = refundListCursorSchema.safeParse(cursor);
  if (!after.success) return { ok: false, message: "We couldn't load more refunds. Reload the page and try again." };

  // The page's own filters; anything malformed falls back to the defaults, as on the page.
  const parsed = paymentListFiltersSchema.safeParse(filters);
  const { date } = parsed.success ? parsed.data : DEFAULT_PAYMENT_LIST_FILTERS;

  try {
    const page = await getRefundListPage(member.store, date, new Date(), after.data);
    return { ok: true, ...page };
  } catch (error) {
    logger.error(`[refunds] loading more refunds for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, message: "We couldn't load more refunds. Try again." };
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
function invalid(error: z.ZodError): RefundActionResult {
  if (hasIssue(error, "clientRequestId")) return { ok: false, code: "INVALID_INPUT", message: PAYMENT_FORM_EXPIRED_MESSAGE };
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = FIELDS.find((name) => name === issue.path[0]);
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  if (Object.keys(fieldErrors).length === 0) {
    return { ok: false, code: "INVALID_INPUT", message: "This refund can't be saved. Close the form and try again." };
  }
  return { ok: false, code: "INVALID_INPUT", message: "Check the highlighted fields.", fieldErrors };
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
