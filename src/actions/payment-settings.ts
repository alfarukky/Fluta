"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { formatCalendarDate, getLocalDateKey } from "@/lib/time";
import { logger } from "@/lib/logger";
import { changeAccountSchema, connectAccountSchema, settlementAccountSchema } from "@/schemas/online-payments";
import { ownerEditRefusalMessage } from "@/server/auth/access";
import { checkOwnPassword } from "@/server/auth/password-check";
import { requireOwnerCanEdit } from "@/server/auth/session";
import {
  changeSettlementAccount as changeAccount,
  connectSettlementAccount as connectAccount,
  resolveSettlementAccount as resolveAccount,
  savePayLater,
  type AccountProblem,
  type ConnectedAccount,
} from "@/server/services/payment-settings";

import type { SettingsActionResult } from "./store-settings";

// Settings → Payments actions (plan section 4). Owner only: each one checks
// the membership itself and that the store may be edited, and the store is
// always the owner's own, from that membership. Account numbers are never
// logged or returned; only the last 4 digits come back.

export interface ResolvedAccountView {
  bankName: string;
  accountName: string;
}

export interface ConnectedAccountView {
  bankName: string;
  accountName: string;
  last4: string;
  // "Tue, 20 Oct 2026", in the store's time zone.
  connectedOn: string;
}

const NOT_OWNER = "Only the store owner can change payment settings.";
const SAVE_FAILED = "We couldn't save your changes. Please try again.";

const PROBLEMS: Record<AccountProblem, { message: string; fieldErrors?: Record<string, string> }> = {
  NOT_CONFIGURED: { message: "Online payments aren't set up in this environment." },
  UNKNOWN_BANK: { message: "Check the highlighted fields and try again.", fieldErrors: { bankId: "Choose your bank" } },
  ACCOUNT_NOT_FOUND: {
    message: "We couldn't find that account.",
    fieldErrors: { accountNumber: "No account with this number at the bank you chose. Check both and try again." },
  },
  NAME_MISMATCH: { message: "The account name doesn't match the one you checked. Check the account again." },
  RATE_LIMITED: { message: "Paystack has had too many requests from us. Please try again later." },
  UNAVAILABLE: { message: "Paystack isn't responding right now. Please try again in a few minutes." },
};

export async function resolveSettlementAccount(formData: FormData): Promise<SettingsActionResult<ResolvedAccountView>> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const parsed = settlementAccountSchema.safeParse(pick(formData, ["bankId", "accountNumber"]));
  if (!parsed.success) return invalid(parsed.error.issues);

  const result = await resolveAccount(member.store.id, parsed.data);
  if (!result.ok) return { ok: false, ...PROBLEMS[result.problem] };
  return {
    ok: true,
    message: "Account found",
    values: { bankName: result.bankName, accountName: result.accountName },
  };
}

export async function connectSettlementAccount(formData: FormData): Promise<SettingsActionResult<ConnectedAccountView>> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const parsed = connectAccountSchema.safeParse(pick(formData, ["businessName", "bankId", "accountNumber", "accountName"]));
  if (!parsed.success) return invalid(parsed.error.issues);

  let result: Awaited<ReturnType<typeof connectAccount>>;
  try {
    result = await connectAccount(member.store.id, { userId: member.user.id, email: member.user.email }, parsed.data);
  } catch (error) {
    logger.error("[payment-settings] connecting failed:", describeError(error)); // never the account number
    return { ok: false, message: "We couldn't connect your bank account. Please try again." };
  }

  if (!result.ok) {
    if (result.problem === "ALREADY_CONNECTED") {
      return { ok: false, message: "Your store is already connected. Refresh the page to see its bank account." };
    }
    if (result.problem === "SAVE_FAILED") return { ok: false, message: "We couldn't connect your bank account. Please try again." };
    return { ok: false, ...PROBLEMS[result.problem] };
  }
  revalidatePath("/settings/payments");
  return { ok: true, message: "Bank account connected", values: toView(result.account, member.store.timeZone) };
}

export async function changeSettlementAccount(formData: FormData): Promise<SettingsActionResult<ConnectedAccountView>> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const parsed = changeAccountSchema.safeParse(pick(formData, ["bankId", "accountNumber", "accountName", "password"]));
  if (!parsed.success) return invalid(parsed.error.issues);
  const { password, ...account } = parsed.data;

  // The password is checked before anything reaches Paystack (plan 4.3).
  const check = await checkOwnPassword(await headers(), password);
  if (check === "WRONG") {
    return { ok: false, message: "That password isn't right", fieldErrors: { password: "That password isn't right" } };
  }
  if (check === "RATE_LIMITED") return { ok: false, message: "Too many attempts. Wait a few minutes and try again." };
  if (check === "FAILED") return { ok: false, message: SAVE_FAILED };

  let result: Awaited<ReturnType<typeof changeAccount>>;
  try {
    result = await changeAccount(
      member.store.id,
      { userId: member.user.id, email: member.user.email },
      account,
      { name: member.store.name, timeZone: member.store.timeZone },
    );
  } catch (error) {
    logger.error("[payment-settings] changing the bank account failed:", describeError(error));
    return { ok: false, message: "We couldn't change your bank account. Please try again." };
  }

  if (!result.ok) {
    if (result.problem === "NOT_CONNECTED") return { ok: false, message: "Connect a bank account first." };
    if (result.problem === "SAVE_FAILED") return { ok: false, message: "We couldn't change your bank account. Please try again." };
    return { ok: false, ...PROBLEMS[result.problem] };
  }
  revalidatePath("/settings/payments");
  return { ok: true, message: "Bank account changed", values: toView(result.account, member.store.timeZone) };
}

// "Let customers pay later". Only once the store is connected.
export async function setPayLater(enabled: unknown): Promise<SettingsActionResult<{ payLaterEnabled: boolean }>> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };
  if (typeof enabled !== "boolean") return { ok: false, message: SAVE_FAILED };

  try {
    if (!(await savePayLater(member.store.id, enabled))) return { ok: false, message: "Connect a bank account first." };
  } catch (error) {
    logger.error("[payment-settings] saving pay later failed:", describeError(error));
    return { ok: false, message: SAVE_FAILED };
  }
  revalidatePath("/settings/payments");
  return {
    ok: true,
    message: enabled ? "Customers can now pay later" : "Customers now pay when they book",
    values: { payLaterEnabled: enabled },
  };
}

function toView(account: ConnectedAccount, timeZone: string): ConnectedAccountView {
  return {
    bankName: account.bankName,
    accountName: account.accountName,
    last4: account.last4,
    connectedOn: formatCalendarDate(getLocalDateKey(account.connectedAt, timeZone)),
  };
}

// Only the named fields, as strings (a missing field is ""; a file is left
// as-is so Zod rejects it).
function pick(formData: FormData, fields: readonly string[]): Record<string, FormDataEntryValue> {
  return Object.fromEntries(fields.map((field) => [field, formData.get(field) ?? ""]));
}

function invalid(issues: readonly { path: PropertyKey[]; message: string }[]): SettingsActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, message: "Check the highlighted fields and try again.", fieldErrors };
}

// The error's class and Prisma code only, never its message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
