"use server";

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/logger";
import { editAddressSchema, issueRevisionSchema, recordDecisionSchema } from "@/schemas/quotes";
import { requireStoreMember } from "@/server/auth/session";
import {
  editOrderAddress,
  issueQuoteRevision,
  ORDER_NOT_FOUND_MESSAGE,
  recordQuoteDecision,
  type DecisionError,
  type QuoteError,
} from "@/server/services/quotes";

// Quotes and revisions from the order detail and edit-quote pages. Owners and
// staff may, whenever the store can work on existing orders. The store and
// user come from the membership; order, line, service, area, and revision IDs
// in the request are only used when they belong to that store.

type CommonError = "NOT_ALLOWED_FOR_STORE" | "INVALID_INPUT" | "SAVE_FAILED";

export type QuoteActionResult =
  | { ok: true; message: string }
  | { ok: false; code: QuoteError | DecisionError | CommonError; message: string; fieldErrors?: Record<string, string> };

async function requireOrderWorker() {
  const member = await requireStoreMember();
  if (!member.allowed) {
    return { ok: false as const, result: denied("You can't change this store's orders.") };
  }
  if (!member.access.canWorkOnExistingOrders) {
    return { ok: false as const, result: denied("This store can't work on orders right now.") };
  }
  return { ok: true as const, member };
}

function denied(message: string): QuoteActionResult {
  return { ok: false, code: "NOT_ALLOWED_FOR_STORE", message };
}

// Issue a new quote revision from the edit-quote screen.
export async function issueRevision(request: unknown): Promise<QuoteActionResult> {
  const access = await requireOrderWorker();
  if (!access.ok) return access.result;
  const { member } = access;

  const parsed = issueRevisionSchema.safeParse(request);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await issueQuoteRevision({ storeId: member.store.id, userId: member.user.id }, parsed.data, new Date());
    if (!result.ok) return { ok: false, code: result.error, message: result.message, fieldErrors: result.fieldErrors };
    revalidatePath("/orders", "layout");
    return { ok: true, message: result.message };
  } catch (error) {
    logger.error(`[quotes] issuing a revision for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, code: "SAVE_FAILED", message: "We couldn't save this quote. Please try again." };
  }
}

// Record an approval or decline the customer gave in person or by phone.
export async function recordDecision(request: unknown): Promise<QuoteActionResult> {
  const access = await requireOrderWorker();
  if (!access.ok) return access.result;
  const { member } = access;

  const parsed = recordDecisionSchema.safeParse(request);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await recordQuoteDecision({ storeId: member.store.id, userId: member.user.id }, parsed.data, new Date());
    if (!result.ok) return { ok: false, code: result.error, message: result.message };
    revalidatePath("/orders", "layout");
    return { ok: true, message: result.message };
  } catch (error) {
    logger.error(`[quotes] recording a decision for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, code: "SAVE_FAILED", message: "We couldn't save this decision. Please try again." };
  }
}

// Change a pickup order's address (not a price change, so no revision).
export async function editAddress(request: unknown): Promise<QuoteActionResult> {
  const access = await requireOrderWorker();
  if (!access.ok) return access.result;
  const { member } = access;

  const parsed = editAddressSchema.safeParse(request);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await editOrderAddress({ storeId: member.store.id, userId: member.user.id }, parsed.data, new Date());
    if (!result.ok) return { ok: false, code: result.error, message: result.message };
    revalidatePath("/orders", "layout");
    return { ok: true, message: result.message };
  } catch (error) {
    logger.error(`[quotes] editing an address for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, code: "SAVE_FAILED", message: "We couldn't save the address. Please try again." };
  }
}

// A malformed order ID is treated exactly like another store's order.
function invalid(issues: readonly { path: PropertyKey[]; message: string }[]): QuoteActionResult {
  if (issues.some((issue) => issue.path[0] === "orderId")) {
    return { ok: false, code: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };
  }
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) fieldErrors[issue.path.map(String).join(".") || "form"] ??= issue.message;
  return { ok: false, code: "INVALID_INPUT", message: "Check the highlighted fields and try again.", fieldErrors };
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
