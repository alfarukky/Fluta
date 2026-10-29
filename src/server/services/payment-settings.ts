import "server-only";

import { createHash } from "node:crypto";

import { logger } from "@/lib/logger";
import type { SettlementAccountInput } from "@/schemas/online-payments";
import {
  findStorePaymentSettings,
  saveStoreBankChange,
  saveStoreConnection,
  updateStorePayLater,
} from "@/server/data/payment-settings";
import {
  getPaystackClient,
  PaystackError,
  type PaystackBank,
  type PaystackClient,
  type SettlementAccountDetails,
} from "@/server/integrations/paystack";

import { buildBankChangedEmail, trySendEmail } from "./emails";

// Settings → Payments (plan section 4): connecting the store's bank account
// to Paystack as a subaccount, changing it, and the pay later switch.
// storeId always comes from the caller's membership. The full account number
// goes to Paystack only: it is never stored or logged (last 4 digits only).

export interface ConnectedAccount {
  bankName: string;
  accountName: string;
  last4: string;
  connectedAt: Date;
}

export interface PaymentSettings {
  // False when Paystack isn't configured in this environment.
  available: boolean;
  storeName: string;
  connected: ConnectedAccount | null;
  payLaterEnabled: boolean;
}

export async function getPaymentSettings(storeId: string): Promise<PaymentSettings> {
  const store = await findStorePaymentSettings(storeId);
  return {
    available: getPaystackClient() !== null,
    storeName: store.name,
    connected: toConnectedAccount(store),
    payLaterEnabled: store.payLaterEnabled,
  };
}

function toConnectedAccount(store: Awaited<ReturnType<typeof findStorePaymentSettings>>): ConnectedAccount | null {
  const { paystackSubaccountCode, settlementBankName, settlementAccountName, settlementAccountLast4, paystackConnectedAt } = store;
  if (!paystackSubaccountCode || !settlementBankName || !settlementAccountName || !settlementAccountLast4 || !paystackConnectedAt) {
    return null;
  }
  return {
    bankName: settlementBankName,
    accountName: settlementAccountName,
    last4: settlementAccountLast4,
    connectedAt: paystackConnectedAt,
  };
}

// ───────────── Banks ─────────────

// Not order data, so one list is kept for a day (plan 4.2).
const BANK_LIST_TTL_MS = 24 * 60 * 60 * 1000;
let bankCache: { banks: PaystackBank[]; expiresAt: number } | null = null;

// Null when Paystack isn't configured or the list can't be loaded.
export async function listSettlementBanks(now = Date.now()): Promise<PaystackBank[] | null> {
  const client = getPaystackClient();
  if (!client) return null;
  if (bankCache && bankCache.expiresAt > now) return bankCache.banks;
  try {
    const banks = (await client.listBanks()).sort((a, b) => a.name.localeCompare(b.name));
    if (banks.length > 0) bankCache = { banks, expiresAt: now + BANK_LIST_TTL_MS };
    return banks;
  } catch (error) {
    logPaystackError("listing banks", error);
    return null;
  }
}

// ───────────── Account lookups ─────────────

// The server's own successful lookups, kept for 10 minutes so confirming
// after "Check account" doesn't ask Paystack again (Paystack limits lookups;
// in test mode to a few a day). Only Paystack's answer is kept, never a name
// from the browser. Keyed by a hash of the store, bank code, and account
// number, so no account number is held in memory. Per server process: on
// another instance the confirm step simply looks up again.
const LOOKUP_TTL_MS = 10 * 60 * 1000;
const MAX_LOOKUPS = 1_000;
const lookups = new Map<string, { accountName: string; expiresAt: number }>();

function lookupKey(storeId: string, { bankCode, accountNumber }: SettlementAccountDetails): string {
  return createHash("sha256").update(`${storeId}\n${bankCode}\n${accountNumber}`).digest("hex");
}

function recallLookup(key: string, now: number): string | null {
  const found = lookups.get(key);
  if (!found) return null;
  if (found.expiresAt <= now) {
    lookups.delete(key);
    return null;
  }
  return found.accountName;
}

function rememberLookup(key: string, accountName: string, now: number): void {
  if (lookups.size >= MAX_LOOKUPS) {
    for (const [stored, entry] of lookups) if (entry.expiresAt <= now) lookups.delete(stored);
    // Still full: drop the oldest.
    if (lookups.size >= MAX_LOOKUPS) lookups.delete(lookups.keys().next().value!);
  }
  lookups.set(key, { accountName, expiresAt: now + LOOKUP_TTL_MS });
}

// For tests: forget the cached bank list and account lookups.
export function clearPaymentSettingsCaches(): void {
  bankCache = null;
  lookups.clear();
}

// ───────────── Resolving an account ─────────────

export type AccountProblem =
  // Paystack isn't configured in this environment.
  | "NOT_CONFIGURED"
  // The bank id isn't one of Paystack's settlement banks.
  | "UNKNOWN_BANK"
  // Paystack couldn't find the account (wrong number or bank).
  | "ACCOUNT_NOT_FOUND"
  // The name Paystack returns isn't the one the owner confirmed.
  | "NAME_MISMATCH"
  // Paystack refused the request for now (HTTP 429). In test mode, account
  // lookups are limited to a few a day.
  | "RATE_LIMITED"
  // Paystack failed or timed out.
  | "UNAVAILABLE";

type Resolved =
  | { ok: true; client: PaystackClient; account: SettlementAccountDetails; bankName: string; accountName: string }
  | { ok: false; problem: AccountProblem };

export type ResolveResult = { ok: true; bankName: string; accountName: string } | { ok: false; problem: AccountProblem };

// "Check account": the account holder's name, for the owner to confirm.
export async function resolveSettlementAccount(storeId: string, account: SettlementAccountInput): Promise<ResolveResult> {
  const resolved = await resolve(storeId, account);
  return resolved.ok ? { ok: true, bankName: resolved.bankName, accountName: resolved.accountName } : resolved;
}

async function resolve(storeId: string, account: SettlementAccountInput, confirmedName?: string): Promise<Resolved> {
  const client = getPaystackClient();
  if (!client) return { ok: false, problem: "NOT_CONFIGURED" };

  const banks = await listSettlementBanks();
  if (!banks) return { ok: false, problem: "UNAVAILABLE" };
  const bank = banks.find((candidate) => candidate.id === account.bankId);
  if (!bank) return { ok: false, problem: "UNKNOWN_BANK" };
  // Paystack works with the bank's code; the owner chose the bank by id.
  const details = { bankCode: bank.code, accountNumber: account.accountNumber };

  const key = lookupKey(storeId, details);
  let accountName = recallLookup(key, Date.now());
  if (accountName === null) {
    try {
      ({ accountName } = await client.resolveAccount(details));
    } catch (error) {
      // Paystack answers 400 or 422 when it can't resolve the account.
      if (error instanceof PaystackError && /^HTTP (400|404|422)\b/.test(error.message)) {
        return { ok: false, problem: "ACCOUNT_NOT_FOUND" };
      }
      logPaystackError("resolving an account", error);
      return { ok: false, problem: unavailable(error) };
    }
    rememberLookup(key, accountName, Date.now());
  }

  // The name sent back from the browser is only compared with the server's
  // own lookup (fresh, or remembered from "Check account"), never saved.
  if (confirmedName !== undefined && normalizeName(confirmedName) !== normalizeName(accountName)) {
    return { ok: false, problem: "NAME_MISMATCH" };
  }
  return { ok: true, client, account: details, bankName: bank.name, accountName };
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

// ───────────── Connecting ─────────────

export interface Actor {
  userId: string;
  // The owner's sign-in email: Paystack's primary contact, and where the
  // bank change notice goes.
  email: string;
}

export type ConnectResult =
  | { ok: true; account: ConnectedAccount }
  | { ok: false; problem: AccountProblem | "ALREADY_CONNECTED" | "SAVE_FAILED" };

// Look the account up (or reuse the lookup from "Check account") → create
// the subaccount → save it with the audit event.
// Paystack is called first: nothing meaningful can be saved before the
// subaccount exists. If two connects race, the one that loses switches off
// its own subaccount.
export async function connectSettlementAccount(
  storeId: string,
  actor: Actor,
  input: SettlementAccountInput & { businessName: string; accountName: string },
  now = new Date(),
): Promise<ConnectResult> {
  const store = await findStorePaymentSettings(storeId);
  if (store.paystackSubaccountCode) return { ok: false, problem: "ALREADY_CONNECTED" };

  const resolved = await resolve(storeId, input, input.accountName);
  if (!resolved.ok) return resolved;

  let subaccountCode: string;
  try {
    ({ subaccountCode } = await resolved.client.createSubaccount({
      ...resolved.account,
      businessName: input.businessName,
      primaryContactEmail: actor.email,
    }));
  } catch (error) {
    logPaystackError(`creating a subaccount for store ${storeId}`, error);
    return { ok: false, problem: unavailable(error) };
  }

  const account = { bankName: resolved.bankName, accountName: resolved.accountName, last4: input.accountNumber.slice(-4) };
  let saved: boolean;
  try {
    saved = await saveStoreConnection(storeId, { ...account, subaccountCode }, actor.userId, now);
  } catch (error) {
    // The code isn't secret: logged so it can be linked or switched off by hand.
    logger.error(
      `[payment-settings] subaccount ${subaccountCode} was created for store ${storeId} but saving it failed:`,
      describeError(error),
    );
    return { ok: false, problem: "SAVE_FAILED" };
  }

  if (!saved) {
    await deactivateDuplicate(resolved.client, storeId, subaccountCode);
    return { ok: false, problem: "ALREADY_CONNECTED" };
  }
  logger.info(`[payment-settings] store ${storeId} connected subaccount ${subaccountCode}`);
  return { ok: true, account: { ...account, connectedAt: now } };
}

async function deactivateDuplicate(client: PaystackClient, storeId: string, subaccountCode: string): Promise<void> {
  try {
    await client.updateSubaccount(subaccountCode, { active: false });
    logger.warn(`[payment-settings] store ${storeId} was already connected; switched off duplicate subaccount ${subaccountCode}`);
  } catch (error) {
    logger.error(
      `[payment-settings] store ${storeId} was already connected; switching off duplicate subaccount ${subaccountCode} failed:`,
      describeError(error),
    );
  }
}

// ───────────── Changing the bank account ─────────────

export type ChangeResult =
  | { ok: true; account: ConnectedAccount }
  | { ok: false; problem: AccountProblem | "NOT_CONNECTED" | "SAVE_FAILED" };

// The owner's password has already been checked (see the action). Look the
// account up (or reuse the lookup from "Check account") → update the same
// subaccount on Paystack → save with the audit event → email the owner after
// the commit.
export async function changeSettlementAccount(
  storeId: string,
  actor: Actor,
  input: SettlementAccountInput & { accountName: string },
  store: { name: string; timeZone: string },
  now = new Date(),
): Promise<ChangeResult> {
  const current = await findStorePaymentSettings(storeId);
  const connected = toConnectedAccount(current);
  const subaccountCode = current.paystackSubaccountCode;
  if (!connected || !subaccountCode) return { ok: false, problem: "NOT_CONNECTED" };

  const resolved = await resolve(storeId, input, input.accountName);
  if (!resolved.ok) return resolved;

  try {
    await resolved.client.updateSubaccount(subaccountCode, resolved.account);
  } catch (error) {
    logPaystackError(`updating subaccount ${subaccountCode} for store ${storeId}`, error);
    return { ok: false, problem: unavailable(error) };
  }

  const account = { bankName: resolved.bankName, accountName: resolved.accountName, last4: input.accountNumber.slice(-4) };
  let saved: boolean;
  try {
    saved = await saveStoreBankChange(storeId, subaccountCode, account, actor.userId, now);
  } catch (error) {
    logger.error(
      `[payment-settings] subaccount ${subaccountCode} for store ${storeId} was updated on Paystack but saving it failed:`,
      describeError(error),
    );
    return { ok: false, problem: "SAVE_FAILED" };
  }
  if (!saved) {
    logger.error(`[payment-settings] subaccount ${subaccountCode} for store ${storeId} was updated on Paystack but the store changed`);
    return { ok: false, problem: "SAVE_FAILED" };
  }

  logger.info(`[payment-settings] store ${storeId} changed the bank account for subaccount ${subaccountCode}`);
  const sent = await trySendEmail(
    buildBankChangedEmail({ to: actor.email, storeName: store.name, ...account, changedAt: now, timeZone: store.timeZone }),
    "bank account changed",
  );
  logger.info(`[payment-settings] bank change notice for store ${storeId} ${sent ? "sent" : "not sent"}`);
  return { ok: true, account: { ...account, connectedAt: connected.connectedAt } };
}

// ───────────── Pay later ─────────────

// False when the store isn't connected (the switch is hidden then).
export async function savePayLater(storeId: string, enabled: boolean): Promise<boolean> {
  return updateStorePayLater(storeId, enabled);
}

function unavailable(error: unknown): "RATE_LIMITED" | "UNAVAILABLE" {
  return error instanceof PaystackError && /^HTTP 429\b/.test(error.message) ? "RATE_LIMITED" : "UNAVAILABLE";
}

// ───────────── Logging ─────────────

// PaystackError messages are short codes only; anything else is logged by
// class and Prisma code, never its message (it could repeat the request).
function logPaystackError(step: string, error: unknown): void {
  logger.error(`[payment-settings] ${step} failed:`, describeError(error));
}

function describeError(error: unknown): string {
  if (error instanceof PaystackError) return `PaystackError ${error.message}`;
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
