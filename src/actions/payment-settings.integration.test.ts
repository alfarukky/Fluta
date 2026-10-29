import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { clearPaymentSettingsCaches } from "@/server/services/payment-settings";
import { randomIp, seedPassword, signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { PaystackError } from "@/server/integrations/paystack-error";
import { fakeMailer, fakePaystack } from "@/test/integration/fakes";

import {
  changeSettlementAccount,
  connectSettlementAccount,
  resolveSettlementAccount,
  setPayLater,
} from "./payment-settings";

// The actions read the session from next/headers; here it's the headers of
// whoever the test signed in as, with a client IP of its own.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers, cookies: async () => ({ set: () => {}, get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const PAYSTACK_FIELDS = {
  payLaterEnabled: true,
  paystackSubaccountCode: true,
  settlementBankName: true,
  settlementAccountName: true,
  settlementAccountLast4: true,
  paystackConnectedAt: true,
} as const;
const DISCONNECTED = {
  payLaterEnabled: false,
  paystackSubaccountCode: null,
  settlementBankName: null,
  settlementAccountName: null,
  settlementAccountLast4: null,
  paystackConnectedAt: null,
};

// The fake client's banks (by Paystack id) and accounts (src/test/fake-paystack.ts).
const GTBANK = { bankId: "9", accountNumber: "0123454521", accountName: "AMINA BELLO" };
const ACCESS = { bankId: "1", accountNumber: "0987651234", accountName: "AMINA BELLO" };

let prisma: PrismaClient;
let stores: { freshFold: string; cleanWave: string };
let signedIn: Record<"owner" | "staff" | "rider" | "cleanWaveOwner", Headers>;
let ownerPassword: string;
let startedAt: Date;

beforeAll(async () => {
  prisma = createTestPrisma();
  const [freshFold, cleanWave] = await Promise.all(
    ["freshfold-laundry", "cleanwave-laundry"].map((slug) => prisma.store.findUniqueOrThrow({ where: { slug } })),
  );
  stores = { freshFold: freshFold.id, cleanWave: cleanWave.id };
  signedIn = {
    owner: await signInHeaders("ada@freshfold.example"),
    staff: await signInHeaders("kemi@freshfold.example"),
    rider: await signInHeaders("tayo@freshfold.example"),
    cleanWaveOwner: await signInHeaders("musa@cleanwave.example"),
  };
  ownerPassword = seedPassword();
});

beforeEach(() => {
  startedAt = new Date();
  fakePaystack.reset();
  fakeMailer.reset();
  clearPaymentSettingsCaches();
});

afterEach(async () => {
  await prisma.store.updateMany({ where: { id: { in: [stores.freshFold, stores.cleanWave] } }, data: DISCONNECTED });
  await prisma.auditEvent.deleteMany({
    where: { action: { in: ["PAYSTACK_CONNECTED", "PAYSTACK_BANK_CHANGED"] }, createdAt: { gte: startedAt } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

// Each request gets its own client IP, so rate limits never carry over.
function signInAs(who: keyof typeof signedIn): void {
  request.headers = new Headers(signedIn[who]);
  request.headers.set("x-real-ip", randomIp());
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function readStore(storeId: string) {
  return prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: PAYSTACK_FIELDS });
}

function auditEvents(storeId: string) {
  return prisma.auditEvent.findMany({
    where: { storeId, action: { in: ["PAYSTACK_CONNECTED", "PAYSTACK_BANK_CHANGED"] }, createdAt: { gte: startedAt } },
    orderBy: { createdAt: "asc" },
  });
}

async function connectFreshFold() {
  signInAs("owner");
  const result = await connectSettlementAccount(form({ ...GTBANK, businessName: "FreshFold Laundry" }));
  if (!result.ok) throw new Error(`Connecting failed: ${result.message}`);
  fakePaystack.calls.length = 0;
  return result;
}

describe("resolveSettlementAccount", () => {
  it("returns the account holder's name and the bank's name", async () => {
    signInAs("owner");
    const result = await resolveSettlementAccount(form({ bankId: "9", accountNumber: "0123 454 521" }));
    expect(result).toEqual({
      ok: true,
      message: "Account found",
      values: { bankName: "Guaranty Trust Bank", accountName: "AMINA BELLO" },
    });
  });

  it("reports an account Paystack can't find on the account number field", async () => {
    signInAs("owner");
    const result = await resolveSettlementAccount(form({ bankId: "9", accountNumber: "1111111111" }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { accountNumber: expect.any(String) } });
  });

  it("confirming after Check account reuses the server's own lookup: one Paystack lookup in all", async () => {
    signInAs("owner");
    expect((await resolveSettlementAccount(form(GTBANK))).ok).toBe(true);
    expect((await connectSettlementAccount(form({ ...GTBANK, businessName: "FreshFold Laundry" }))).ok).toBe(true);
    expect(fakePaystack.calls.filter((call) => call === "resolveAccount")).toHaveLength(1);
  });

  it("never shares a lookup between stores", async () => {
    signInAs("owner");
    await resolveSettlementAccount(form(GTBANK));
    signInAs("cleanWaveOwner");
    await resolveSettlementAccount(form(GTBANK));
    expect(fakePaystack.calls.filter((call) => call === "resolveAccount")).toHaveLength(2);
  });

  it("says Paystack's limit was reached when it answers 429", async () => {
    fakePaystack.failNext.resolveAccount = new PaystackError("HTTP 429 api_error");
    signInAs("owner");
    const result = await resolveSettlementAccount(form({ bankId: "9", accountNumber: "0123454521" }));
    expect(result).toEqual({ ok: false, message: "Paystack has had too many requests from us. Please try again later." });
  });

  it("refuses a bank that isn't in Paystack's list, without resolving", async () => {
    signInAs("owner");
    const result = await resolveSettlementAccount(form({ bankId: "999", accountNumber: "0123454521" }));
    expect(result).toMatchObject({ ok: false, fieldErrors: { bankId: "Choose your bank" } });
    expect(fakePaystack.calls).not.toContain("resolveAccount");
  });
});

describe("connectSettlementAccount", () => {
  it("creates a subaccount at 0% for Fluta and saves the connection with an audit event", async () => {
    signInAs("owner");
    const result = await connectSettlementAccount(form({ ...GTBANK, businessName: "FreshFold Laundry" }));
    expect(result).toMatchObject({
      ok: true,
      values: { bankName: "Guaranty Trust Bank", accountName: "AMINA BELLO", last4: "4521" },
    });

    const store = await readStore(stores.freshFold);
    expect(store).toMatchObject({
      paystackSubaccountCode: expect.stringMatching(/^ACCT_fake/),
      settlementBankName: "Guaranty Trust Bank",
      settlementAccountName: "AMINA BELLO",
      settlementAccountLast4: "4521",
      paystackConnectedAt: expect.any(Date),
    });
    const subaccount = fakePaystack.subaccounts.get(store.paystackSubaccountCode!);
    expect(subaccount).toMatchObject({ percentageCharge: 0, businessName: "FreshFold Laundry", active: true });

    const [event] = await auditEvents(stores.freshFold);
    expect(event).toMatchObject({
      action: "PAYSTACK_CONNECTED",
      actorType: "STAFF",
      targetType: "Store",
      metadata: { subaccountCode: store.paystackSubaccountCode, bankName: "Guaranty Trust Bank", last4: "4521" },
    });
    // The full account number is never stored.
    expect(JSON.stringify([store, event])).not.toContain(GTBANK.accountNumber);
  });

  it("saves the name of the bank the owner chose when two banks share a code", async () => {
    fakePaystack.accounts.set("50739:0123450739", "AMINA BELLO");
    signInAs("owner");
    const result = await connectSettlementAccount(
      form({ bankId: "792", accountNumber: "0123450739", accountName: "AMINA BELLO", businessName: "FreshFold Laundry" }),
    );
    expect(result).toMatchObject({ ok: true, values: { bankName: "Prospa Capital Microfinance Bank", last4: "0739" } });
    expect((await readStore(stores.freshFold)).settlementBankName).toBe("Prospa Capital Microfinance Bank");
  });

  it("refuses when the account name doesn't match the one the owner confirmed, and creates nothing", async () => {
    signInAs("owner");
    const result = await connectSettlementAccount(
      form({ ...GTBANK, accountName: "SOMEONE ELSE", businessName: "FreshFold Laundry" }),
    );
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("doesn't match") });
    expect(fakePaystack.calls).not.toContain("createSubaccount");
    expect(await readStore(stores.freshFold)).toEqual(DISCONNECTED);
  });

  it("matches the confirmed name ignoring case and spacing", async () => {
    signInAs("owner");
    const result = await connectSettlementAccount(form({ ...GTBANK, accountName: " amina  bello ", businessName: "FreshFold" }));
    expect(result.ok).toBe(true);
  });

  it("saves one subaccount when two connects race, and switches off the other on Paystack", async () => {
    signInAs("owner");
    const values = { ...GTBANK, businessName: "FreshFold Laundry" };
    const results = await Promise.all([connectSettlementAccount(form(values)), connectSettlementAccount(form(values))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);

    const saved = (await readStore(stores.freshFold)).paystackSubaccountCode;
    const created = [...fakePaystack.subaccounts.values()];
    // Both may have reached Paystack; any duplicate is switched off.
    for (const subaccount of created) expect(subaccount.active).toBe(subaccount.subaccountCode === saved);
    expect(await auditEvents(stores.freshFold)).toHaveLength(1);
  });

  it("refuses a store that is already connected, without calling Paystack", async () => {
    await connectFreshFold();
    const result = await connectSettlementAccount(form({ ...ACCESS, businessName: "FreshFold Laundry" }));
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("already connected") });
    expect(fakePaystack.calls).toEqual([]);
  });
});

describe("changeSettlementAccount", () => {
  it("checks the password, updates the same subaccount, writes an audit event, and emails the owner", async () => {
    await connectFreshFold();
    const before = await readStore(stores.freshFold);

    const result = await changeSettlementAccount(form({ ...ACCESS, password: ownerPassword }));
    expect(result).toMatchObject({ ok: true, values: { bankName: "Access Bank", last4: "1234" } });

    const after = await readStore(stores.freshFold);
    expect(after).toMatchObject({
      paystackSubaccountCode: before.paystackSubaccountCode,
      settlementBankName: "Access Bank",
      settlementAccountLast4: "1234",
      paystackConnectedAt: before.paystackConnectedAt,
    });
    expect(fakePaystack.subaccounts.get(before.paystackSubaccountCode!)).toMatchObject({ settlementBank: "Access Bank" });

    const events = await auditEvents(stores.freshFold);
    expect(events.map((event) => event.action)).toEqual(["PAYSTACK_CONNECTED", "PAYSTACK_BANK_CHANGED"]);
    expect(events[1].metadata).toEqual({
      subaccountCode: before.paystackSubaccountCode,
      from: { bankName: "Guaranty Trust Bank", last4: "4521" },
      to: { bankName: "Access Bank", last4: "1234" },
    });

    const email = fakeMailer.lastTo("ada@freshfold.example");
    expect(email?.text).toContain("the bank account for online payments was changed to Access Bank •••• 1234");
    expect(JSON.stringify([events, email])).not.toContain(ACCESS.accountNumber);
  });

  it("refuses a wrong password, and nothing reaches Paystack", async () => {
    await connectFreshFold();
    const before = await readStore(stores.freshFold);

    const result = await changeSettlementAccount(form({ ...ACCESS, password: "not-the-password" }));
    expect(result).toEqual({
      ok: false,
      message: "That password isn't right",
      fieldErrors: { password: "That password isn't right" },
    });
    expect(fakePaystack.calls).toEqual([]);
    expect(await readStore(stores.freshFold)).toEqual(before);
    expect(fakeMailer.sent).toHaveLength(0);
  });

  it("counts wrong passwords toward a rate limit", async () => {
    await connectFreshFold();
    // One client IP for every attempt.
    const results = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      results.push(await changeSettlementAccount(form({ ...ACCESS, password: "not-the-password" })));
    }
    expect(results.at(-1)).toMatchObject({ ok: false, message: "Too many attempts. Wait a few minutes and try again." });
    expect(fakePaystack.calls).toEqual([]);
    // Eleven password checks in a row, each a few database round trips.
  }, 120_000);

  it("refuses a store that isn't connected", async () => {
    signInAs("owner");
    const result = await changeSettlementAccount(form({ ...ACCESS, password: ownerPassword }));
    expect(result).toMatchObject({ ok: false, message: "Connect a bank account first." });
    expect(fakePaystack.calls).not.toContain("updateSubaccount");
  });

  it("a FreshFold owner changes only FreshFold: CleanWave's bank details stay as they were", async () => {
    signInAs("cleanWaveOwner");
    const cleanWave = await connectSettlementAccount(form({ ...GTBANK, businessName: "CleanWave" }));
    expect(cleanWave.ok).toBe(true);
    const cleanWaveBefore = await readStore(stores.cleanWave);

    await connectFreshFold();
    // Any store ID in the form is ignored: the store comes from the membership.
    const result = await changeSettlementAccount(form({ ...ACCESS, password: ownerPassword, storeId: stores.cleanWave }));
    expect(result.ok).toBe(true);
    expect(await readStore(stores.cleanWave)).toEqual(cleanWaveBefore);
    expect((await readStore(stores.freshFold)).settlementBankName).toBe("Access Bank");
  });
});

describe("setPayLater", () => {
  it("is refused before the store is connected, and saved once it is", async () => {
    signInAs("owner");
    expect(await setPayLater(true)).toMatchObject({ ok: false, message: "Connect a bank account first." });
    expect((await readStore(stores.freshFold)).payLaterEnabled).toBe(false);

    await connectFreshFold();
    expect(await setPayLater(true)).toMatchObject({ ok: true, values: { payLaterEnabled: true } });
    expect((await readStore(stores.freshFold)).payLaterEnabled).toBe(true);
  });
});

describe("owner only", () => {
  it.each(["staff", "rider"] as const)("refuses %s for every action, and nothing reaches Paystack", async (who) => {
    signInAs(who);
    const results = await Promise.all([
      resolveSettlementAccount(form(GTBANK)),
      connectSettlementAccount(form({ ...GTBANK, businessName: "FreshFold Laundry" })),
      changeSettlementAccount(form({ ...ACCESS, password: ownerPassword })),
      setPayLater(true),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(fakePaystack.calls).toEqual([]);
    expect(await readStore(stores.freshFold)).toEqual(DISCONNECTED);
  });
});
