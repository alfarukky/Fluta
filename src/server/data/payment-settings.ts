import "server-only";

import { getPrisma } from "./client";

// The store's Paystack connection and online payment settings, always for
// one store: storeId comes from the caller's membership, never the request.
// The full account number is never stored, only its last 4 digits.

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export const PAYSTACK_AUDIT_ACTIONS = {
  connected: "PAYSTACK_CONNECTED",
  bankChanged: "PAYSTACK_BANK_CHANGED",
} as const;
const AUDIT_TARGET = "Store";

const PAYMENT_SETTINGS_SELECT = {
  name: true,
  payLaterEnabled: true,
  paystackSubaccountCode: true,
  settlementBankName: true,
  settlementAccountName: true,
  settlementAccountLast4: true,
  paystackConnectedAt: true,
} as const;

export interface StorePaymentSettings {
  name: string;
  payLaterEnabled: boolean;
  paystackSubaccountCode: string | null;
  settlementBankName: string | null;
  settlementAccountName: string | null;
  settlementAccountLast4: string | null;
  paystackConnectedAt: Date | null;
}

export interface SettlementAccountRecord {
  bankName: string;
  accountName: string;
  last4: string;
}

export async function findStorePaymentSettings(storeId: string): Promise<StorePaymentSettings> {
  return getPrisma().store.findUniqueOrThrow({ where: { id: storeId }, select: PAYMENT_SETTINGS_SELECT });
}

// Saves a new connection, only if the store has none yet: of two connects
// racing, one saves and the other gets false (its subaccount is then switched
// off by the caller). The audit event is written in the same transaction.
export async function saveStoreConnection(
  storeId: string,
  connection: SettlementAccountRecord & { subaccountCode: string },
  actorUserId: string,
  now = new Date(),
): Promise<boolean> {
  return getPrisma().$transaction(async (tx) => {
    const { count } = await tx.store.updateMany({
      where: { id: storeId, paystackSubaccountCode: null },
      data: {
        paystackSubaccountCode: connection.subaccountCode,
        settlementBankName: connection.bankName,
        settlementAccountName: connection.accountName,
        settlementAccountLast4: connection.last4,
        paystackConnectedAt: now,
      },
    });
    if (count === 0) return false;

    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "STAFF",
        actorUserId,
        action: PAYSTACK_AUDIT_ACTIONS.connected,
        targetType: AUDIT_TARGET,
        targetId: storeId,
        metadata: { subaccountCode: connection.subaccountCode, bankName: connection.bankName, last4: connection.last4 },
        createdAt: now,
      },
    });
    return true;
  }, TRANSACTION_OPTIONS);
}

// Saves the new bank account for the same subaccount, with an audit event
// holding the old and new bank name and last 4 digits only. Returns false
// when the store's subaccount is no longer `subaccountCode`.
export async function saveStoreBankChange(
  storeId: string,
  subaccountCode: string,
  account: SettlementAccountRecord,
  actorUserId: string,
  now = new Date(),
): Promise<boolean> {
  return getPrisma().$transaction(async (tx) => {
    const previous = await tx.store.findFirst({
      where: { id: storeId, paystackSubaccountCode: subaccountCode },
      select: { settlementBankName: true, settlementAccountLast4: true },
    });
    if (!previous) return false;

    const { count } = await tx.store.updateMany({
      where: { id: storeId, paystackSubaccountCode: subaccountCode },
      data: {
        settlementBankName: account.bankName,
        settlementAccountName: account.accountName,
        settlementAccountLast4: account.last4,
      },
    });
    if (count === 0) return false;

    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "STAFF",
        actorUserId,
        action: PAYSTACK_AUDIT_ACTIONS.bankChanged,
        targetType: AUDIT_TARGET,
        targetId: storeId,
        metadata: {
          subaccountCode,
          from: { bankName: previous.settlementBankName, last4: previous.settlementAccountLast4 },
          to: { bankName: account.bankName, last4: account.last4 },
        },
        createdAt: now,
      },
    });
    return true;
  }, TRANSACTION_OPTIONS);
}

// Pay later can only be changed once the store is connected. Returns false
// when it isn't.
export async function updateStorePayLater(storeId: string, enabled: boolean): Promise<boolean> {
  const { count } = await getPrisma().store.updateMany({
    where: { id: storeId, paystackSubaccountCode: { not: null } },
    data: { payLaterEnabled: enabled },
  });
  return count > 0;
}
