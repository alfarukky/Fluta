import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { OrderStage, PaymentMethod, PrismaClient } from "@/generated/prisma/client";
import { describeBalance } from "@/lib/payments";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { voidStorePayment } from "@/server/data/payments";
import { createUserWithPassword } from "@/server/data/users";
import { getOrderDetail } from "@/server/services/orders";
import { recordStorePayment, voidPayment as voidPaymentAsService } from "@/server/services/payments";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { recordPayment, voidPayment } from "./payments";

// The actions read the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Each test builds orders and records payments through several Neon round trips.
vi.setConfig({ testTimeout: 90_000 });

// Orders live in a throwaway store with its own owners, staff, and rider, so
// the seeded stores never change (CleanWave is only ever read).
const EMAIL_DOMAIN = "payments-test.example";
const PASSWORD = "test-password-1234";

type Role = "owner" | "secondOwner" | "staff" | "rider";

let prisma: PrismaClient;
let storeId: string;
let customerId: string;
let users: Record<Role, { id: string; headers: Headers }>;
let freshFoldOwner: Headers;
let cleanWave: { orderId: string; paymentId: string };
let nextOrderNumber = 1;

beforeAll(async () => {
  prisma = createTestPrisma();
  const suffix = randomUUID().slice(0, 8);
  const store = await prisma.store.create({
    data: {
      name: "Payments Test Laundry",
      slug: `payments-test-${suffix}`,
      orderPrefix: "PT",
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: { name: "Payment Test Customer", phone: "+2348030000002" } },
    },
    select: { id: true, customers: { select: { id: true } } },
  });
  storeId = store.id;
  customerId = store.customers[0].id;
  users = {
    owner: await addUser("owner", "OWNER"),
    secondOwner: await addUser("second-owner", "OWNER"),
    staff: await addUser("staff", "STAFF"),
    rider: await addUser("rider", "RIDER"),
  };
  freshFoldOwner = await signInHeaders("ada@freshfold.example");

  const payment = await prisma.payment.findFirstOrThrow({
    where: { store: { slug: "cleanwave-laundry" }, source: "STORE_COLLECTED", status: "CONFIRMED" },
    select: { id: true, orderId: true },
  });
  cleanWave = { orderId: payment.orderId, paymentId: payment.id };
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, payments, or users.
  const where = { storeId };
  await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
  await prisma.payment.updateMany({ where, data: { replacesPaymentId: null } });
  await prisma.$transaction(
    [
      prisma.auditEvent.deleteMany({ where }),
      prisma.messageEvent.deleteMany({ where }),
      prisma.statusEvent.deleteMany({ where }),
      prisma.payment.deleteMany({ where }),
      prisma.quoteRevision.deleteMany({ where }),
      prisma.notification.deleteMany({ where }),
      prisma.order.deleteMany({ where }),
      prisma.customer.deleteMany({ where }),
      prisma.subscription.deleteMany({ where }),
      prisma.membership.deleteMany({ where }),
    ],
    { maxWait: 15_000, timeout: 30_000 },
  );
  const userIds = (
    await prisma.user.findMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } }, select: { id: true } })
  ).map((user) => user.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  // Includes any left by an earlier run that stopped before its cleanup.
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.store.delete({ where: { id: storeId } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function addUser(label: string, role: "OWNER" | "STAFF" | "RIDER"): Promise<{ id: string; headers: Headers }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const { id } = await createUserWithPassword({ name: `Test ${label}`, email, password: PASSWORD }, prisma);
  const result = await createMembership(storeId, { userId: id, role }, prisma);
  if (!result.success) throw new Error(`Couldn't add ${email} to the test store`);
  return { id, headers: await signInHeaders(email, PASSWORD) };
}

// An order at `stage`, with an approved price of `total` (null: none yet).
async function makeOrder(stage: OrderStage = "READY", total: number | null = 500_000): Promise<string> {
  const order = await prisma.order.create({
    data: {
      storeId,
      orderNumber: nextOrderNumber++,
      customerId,
      channel: "COUNTER",
      fulfilmentType: "DROP_OFF",
      stage,
      trackingTokenHash: randomUUID(),
      trackingTokenIssuedAt: new Date(),
      completedAt: stage === "COMPLETED" ? new Date() : null,
      cancelledAt: stage === "CANCELLED" ? new Date() : null,
    },
    select: { id: true },
  });
  await addRevision(order.id, 1, total ?? 450_000, total !== null);
  return order.id;
}

// A new approved price, as an approved revision would leave it.
async function approvePrice(orderId: string, total: number): Promise<void> {
  const versions = await prisma.quoteRevision.count({ where: { storeId, orderId } });
  await prisma.quoteRevision.updateMany({ where: { storeId, orderId, status: "APPROVED" }, data: { status: "SUPERSEDED" } });
  await addRevision(orderId, versions + 1, total, true);
}

async function addRevision(orderId: string, version: number, total: number, approved: boolean): Promise<void> {
  // One moment for both: an approval at the revision's creation time isn't a
  // separate timeline entry. Prisma's own createdAt default can land a
  // millisecond later, which made the timeline test flaky.
  const at = new Date();
  const revision = await prisma.quoteRevision.create({
    data: {
      storeId,
      orderId,
      version,
      linesSnapshot: [],
      itemsSubtotal: total,
      total,
      status: approved ? "APPROVED" : "PENDING",
      createdByActor: "STAFF",
      createdByUserId: users.staff.id,
      createdAt: at,
      approvedAt: approved ? at : null,
      approvedByActor: approved ? "STAFF" : null,
    },
    select: { id: true },
  });
  if (approved) await prisma.order.update({ where: { id: orderId }, data: { approvedQuoteId: revision.id } });
}

interface RecordOptions {
  as?: Headers;
  method?: PaymentMethod;
  requestId?: string;
  confirmedExcess?: number | null;
  reference?: string;
}

function record(orderId: string, amount: string, options: RecordOptions = {}) {
  request.headers = options.as ?? users.staff.headers;
  return recordPayment({
    orderId,
    clientRequestId: options.requestId ?? randomUUID(),
    amount,
    method: options.method ?? "CASH",
    reference: options.reference ?? "",
    note: "",
    confirmedExcess: options.confirmedExcess ?? null,
  });
}

interface Replacement {
  amount: string;
  method?: PaymentMethod;
  requestId?: string;
  confirmedExcess?: number | null;
}

function voidIt(paymentId: string, reason: string, options: { as?: Headers; replace?: Replacement } = {}) {
  request.headers = options.as ?? users.owner.headers;
  const { replace } = options;
  if (!replace) return voidPayment({ mode: "VOID_ONLY", paymentId, reason });
  return voidPayment({
    mode: "REPLACE",
    paymentId,
    reason,
    clientRequestId: replace.requestId ?? randomUUID(),
    confirmedExcess: replace.confirmedExcess ?? null,
    amount: replace.amount,
    method: replace.method ?? "CASH",
    reference: "",
    note: "",
  });
}

async function balanceOf(orderId: string) {
  const detail = await getOrderDetail(storeId, orderId, "OWNER");
  if (!detail) throw new Error("The test order is missing");
  return detail.balance;
}

async function paymentsOf(orderId: string) {
  return prisma.payment.findMany({ where: { storeId, orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

async function onlyPayment(orderId: string): Promise<string> {
  const payments = await paymentsOf(orderId);
  expect(payments).toHaveLength(1);
  return payments[0].id;
}

describe("recording a payment", () => {
  it.each(["CASH", "BANK_TRANSFER", "POS", "OTHER"] as const)("staff record %s, confirmed at once", async (method) => {
    const orderId = await makeOrder();
    const result = await record(orderId, "2,000", { method, reference: " TRX-77 " });
    expect(result).toEqual({ ok: true, message: "Payment recorded" });

    const [payment] = await paymentsOf(orderId);
    expect(payment).toMatchObject({
      amount: 200_000,
      method,
      source: "STORE_COLLECTED",
      status: "CONFIRMED",
      recordedByUserId: users.staff.id,
      reference: "TRX-77",
      note: null,
      voidedAt: null,
    });
    expect(payment.confirmedAt).toBeInstanceOf(Date);
    expect(Number.isInteger(payment.amount)).toBe(true);
  });

  it("never takes a Fluta fee, even at a store with an online fee rate", async () => {
    await prisma.store.update({ where: { id: storeId }, data: { onlineFeeBps: 150 } });
    try {
      const orderId = await makeOrder();
      expect(await record(orderId, "2,000")).toMatchObject({ ok: true });
      const [payment] = await paymentsOf(orderId);
      expect(payment).toMatchObject({ source: "STORE_COLLECTED", flutaFeeBps: null, flutaFeeAmount: null, paystackReference: null });
    } finally {
      await prisma.store.update({ where: { id: storeId }, data: { onlineFeeBps: 0 } });
    }
  });

  it("moves the order from Outstanding to Paid to Refund owed, through getBalance", async () => {
    const orderId = await makeOrder("READY", 500_000);
    expect(await balanceOf(orderId)).toMatchObject({ state: "OUTSTANDING", balanceKobo: 500_000 });

    await record(orderId, "2,000");
    expect(await balanceOf(orderId)).toMatchObject({ state: "OUTSTANDING", balanceKobo: 300_000 });

    await record(orderId, "3,000", { method: "POS" });
    expect(await balanceOf(orderId)).toMatchObject({ state: "PAID", balanceKobo: 0 });

    await record(orderId, "500", { confirmedExcess: 50_000 });
    expect(await balanceOf(orderId)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -50_000 });
  });

  it("saves a deposit before the price is approved, shown as Paid so far", async () => {
    const orderId = await makeOrder("RECEIVED_BY_STORE", null);
    expect(await record(orderId, "5,000")).toMatchObject({ ok: true });

    const balance = await balanceOf(orderId);
    expect(balance).toMatchObject({ state: "AWAITING_QUOTE", balanceKobo: null, confirmedPaymentsKobo: 500_000 });
    expect(describeBalance(balance)).toEqual({ label: "Paid so far", value: "₦5,000" });
  });

  it("shows Refund owed ₦1,000 after a ₦5,000 deposit and an approved ₦4,000 price", async () => {
    const orderId = await makeOrder("RECEIVED_BY_STORE", null);
    await record(orderId, "5,000");
    await approvePrice(orderId, 400_000);

    const balance = await balanceOf(orderId);
    expect(balance).toMatchObject({ state: "REFUND_OWED", balanceKobo: -100_000 });
    expect(describeBalance(balance)).toEqual({ label: "Refund owed", value: "₦1,000" });
  });

  it("records on a completed order", async () => {
    const orderId = await makeOrder("COMPLETED");
    expect(await record(orderId, "5,000")).toMatchObject({ ok: true });
    expect(await balanceOf(orderId)).toMatchObject({ state: "PAID" });
  });

  it("writes no status event", async () => {
    const orderId = await makeOrder("IN_PROGRESS");
    await record(orderId, "1,000");
    await record(orderId, "1,000");
    expect(await prisma.statusEvent.count({ where: { storeId, orderId } })).toBe(0);
    const detail = await getOrderDetail(storeId, orderId, "STAFF");
    expect(detail?.timeline.map((entry) => entry.kind)).toEqual(["payment", "payment"]);
  });

  it("refuses an amount out of range, with the message under the field", async () => {
    const orderId = await makeOrder();
    expect(await record(orderId, "0")).toMatchObject({ ok: false, fieldErrors: { amount: "Enter an amount above ₦0" } });
    expect(await record(orderId, "10,000,000.01", { confirmedExcess: 1_000_000_000 })).toMatchObject({
      ok: false,
      fieldErrors: { amount: "Amount must be ₦10,000,000 or less" },
    });
    request.headers = users.staff.headers;
    expect(
      await recordPayment({ orderId, clientRequestId: randomUUID(), amount: "1,000", method: "PAYSTACK" }),
    ).toMatchObject({ ok: false, fieldErrors: { method: "Choose how the customer paid" } });
    expect(await paymentsOf(orderId)).toHaveLength(0);
  });

  it("refuses a cancelled order", async () => {
    const orderId = await makeOrder("CANCELLED");
    expect(await record(orderId, "1,000")).toMatchObject({ ok: false, code: "ORDER_CANCELLED" });
    expect(await paymentsOf(orderId)).toHaveLength(0);
  });

  it("refuses a rider", async () => {
    const orderId = await makeOrder();
    expect(await record(orderId, "1,000", { as: users.rider.headers })).toMatchObject({ ok: false, code: "NOT_ALLOWED_FOR_STORE" });
    expect(await paymentsOf(orderId)).toHaveLength(0);
  });
});

describe("overpayments", () => {
  it("refuses an overpayment nobody confirmed, then records the confirmed one", async () => {
    const orderId = await makeOrder("READY", 500_000);
    const refused = await record(orderId, "6,000");
    expect(refused).toMatchObject({
      ok: false,
      code: "OVERPAYMENT_UNCONFIRMED",
      overpayment: { balanceKobo: 500_000, excessKobo: 100_000, refundOwedKobo: 100_000 },
    });
    expect(await paymentsOf(orderId)).toHaveLength(0);

    expect(await record(orderId, "6,000", { confirmedExcess: 100_000 })).toMatchObject({ ok: true });
    expect(await balanceOf(orderId)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -100_000 });
  });

  it("stops a stale form: another payment was recorded while it was open, and the confirmed retry succeeds", async () => {
    const orderId = await makeOrder("READY", 500_000);
    // The form opened at ₦5,000 due. Meanwhile someone else records ₦2,000.
    const requestId = randomUUID();
    await record(orderId, "2,000", { as: users.owner.headers });

    const stale = await record(orderId, "5,000", { requestId });
    expect(stale).toEqual({
      ok: false,
      code: "OVERPAYMENT_UNCONFIRMED",
      message: "The balance has changed. ₦3,000 is now due. This payment is ₦2,000 more. Record it anyway?",
      overpayment: { balanceKobo: 300_000, excessKobo: 200_000, refundOwedKobo: 200_000 },
    });
    expect(await paymentsOf(orderId)).toHaveLength(1);

    expect(await record(orderId, "5,000", { requestId, confirmedExcess: 200_000 })).toMatchObject({ ok: true });
    expect(await balanceOf(orderId)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -200_000 });
  });
});

describe("double submits", () => {
  it("returns the same payment for the same request ID", async () => {
    const orderId = await makeOrder();
    const requestId = randomUUID();
    expect(await record(orderId, "1,000", { requestId })).toMatchObject({ ok: true });
    expect(await record(orderId, "1,000", { requestId })).toMatchObject({ ok: true, message: "Payment recorded" });
    expect(await paymentsOf(orderId)).toHaveLength(1);
  });

  it("creates one payment when both arrive at the same moment", async () => {
    const orderId = await makeOrder();
    const input = {
      orderId,
      clientRequestId: randomUUID(),
      amount: 100_000,
      method: "CASH" as const,
      reference: null,
      note: null,
      confirmedExcess: null,
    };
    const actor = { storeId, userId: users.staff.id };
    const results = await Promise.all([
      recordStorePayment(actor, input, new Date()),
      recordStorePayment(actor, input, new Date()),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(await paymentsOf(orderId)).toHaveLength(1);
  });

  it("refuses a request ID already used on another order", async () => {
    const [first, second] = [await makeOrder(), await makeOrder()];
    const requestId = randomUUID();
    await record(first, "1,000", { requestId });
    expect(await record(second, "1,000", { requestId })).toMatchObject({ ok: false, code: "REQUEST_REUSED" });
    expect(await paymentsOf(second)).toHaveLength(0);
  });
});

describe("voiding a payment", () => {
  it("lets only owners void, with a reason, and the voided payment stops counting", async () => {
    const orderId = await makeOrder("READY", 500_000);
    await record(orderId, "5,000");
    const paymentId = await onlyPayment(orderId);

    expect(await voidIt(paymentId, "Entered twice", { as: users.staff.headers })).toMatchObject({
      ok: false,
      message: "Only the store owner can void payments.",
    });
    expect(await voidIt(paymentId, "   ")).toMatchObject({
      ok: false,
      fieldErrors: { reason: "Add a reason for voiding this payment" },
    });
    expect((await paymentsOf(orderId))[0].status).toBe("CONFIRMED");

    expect(await voidIt(paymentId, " Entered twice ")).toEqual({ ok: true, message: "Payment voided" });
    const [voided] = await paymentsOf(orderId);
    expect(voided).toMatchObject({
      status: "VOIDED",
      voidedByUserId: users.owner.id,
      voidReason: "Entered twice",
      amount: 500_000,
    });
    expect(voided.voidedAt).toBeInstanceOf(Date);
    expect(voided.confirmedAt).toBeInstanceOf(Date);
    expect(await balanceOf(orderId)).toMatchObject({ state: "OUTSTANDING", balanceKobo: 500_000 });

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { storeId, targetId: paymentId } });
    expect(audit).toMatchObject({
      action: "PAYMENT_VOIDED",
      actorType: "STAFF",
      actorUserId: users.owner.id,
      targetType: "Payment",
      reason: "Entered twice",
      metadata: { orderId, amount: 500_000, method: "CASH", replacementPaymentId: null },
    });
  });

  it("keeps a voided payment out of the balance, even after a lower price is approved", async () => {
    const orderId = await makeOrder("READY", 500_000);
    await record(orderId, "5,000");
    expect(await balanceOf(orderId)).toMatchObject({ state: "PAID" });

    await voidIt(await onlyPayment(orderId), "Customer's transfer bounced");
    expect(await balanceOf(orderId)).toMatchObject({ state: "OUTSTANDING", balanceKobo: 500_000 });

    await approvePrice(orderId, 350_000);
    expect(await balanceOf(orderId)).toMatchObject({ state: "OUTSTANDING", balanceKobo: 350_000, confirmedPaymentsKobo: 0 });
  });

  it("voids and records the correct payment in one transaction, linked and audited", async () => {
    const orderId = await makeOrder("READY", 500_000);
    await record(orderId, "5,000");
    const originalId = await onlyPayment(orderId);

    const result = await voidIt(originalId, "Wrong amount", { replace: { amount: "4,000", method: "POS" } });
    expect(result).toEqual({ ok: true, message: "Payment voided and correct payment recorded" });

    const [original, replacement] = await paymentsOf(orderId);
    expect(original).toMatchObject({ id: originalId, status: "VOIDED", voidReason: "Wrong amount" });
    expect(replacement).toMatchObject({
      status: "CONFIRMED",
      amount: 400_000,
      method: "POS",
      source: "STORE_COLLECTED",
      replacesPaymentId: originalId,
      recordedByUserId: users.owner.id,
    });
    expect(replacement.confirmedAt).toEqual(original.voidedAt);
    expect(await balanceOf(orderId)).toMatchObject({ state: "OUTSTANDING", balanceKobo: 100_000 });

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { storeId, targetId: originalId } });
    expect(audit).toMatchObject({
      action: "PAYMENT_CORRECTED",
      reason: "Wrong amount",
      metadata: { orderId, amount: 500_000, method: "CASH", replacementPaymentId: replacement.id },
    });

    // A replacement can itself be voided and replaced, keeping one chain.
    expect(await voidIt(replacement.id, "Still wrong", { replace: { amount: "5,000" } })).toMatchObject({ ok: true });
    const chain = await paymentsOf(orderId);
    expect(chain.map((payment) => [payment.status, payment.replacesPaymentId])).toEqual([
      ["VOIDED", null],
      ["VOIDED", originalId],
      ["CONFIRMED", replacement.id],
    ]);
  });

  it("asks before a replacement goes over the balance", async () => {
    const orderId = await makeOrder("READY", 500_000);
    await record(orderId, "5,000");
    const paymentId = await onlyPayment(orderId);

    const refused = await voidIt(paymentId, "Wrong amount", { replace: { amount: "6,000" } });
    expect(refused).toMatchObject({ ok: false, code: "OVERPAYMENT_UNCONFIRMED", overpayment: { excessKobo: 100_000 } });
    expect((await paymentsOf(orderId)).map((payment) => payment.status)).toEqual(["CONFIRMED"]);

    expect(await voidIt(paymentId, "Wrong amount", { replace: { amount: "6,000", confirmedExcess: 100_000 } })).toMatchObject({
      ok: true,
    });
  });

  it("returns the same replacement for a retried void and replace, and success for a retried void only", async () => {
    const orderId = await makeOrder("READY", 500_000);
    await record(orderId, "5,000");
    const originalId = await onlyPayment(orderId);
    const replace = { amount: "4,000", requestId: randomUUID() };

    expect(await voidIt(originalId, "Wrong amount", { replace })).toMatchObject({ ok: true });
    expect(await voidIt(originalId, "Wrong amount", { replace })).toEqual({
      ok: true,
      message: "Payment voided and correct payment recorded",
    });
    expect(await paymentsOf(orderId)).toHaveLength(2);
    expect(await prisma.auditEvent.count({ where: { storeId, targetId: originalId } })).toBe(1);

    const other = await makeOrder();
    await record(other, "1,000");
    const otherId = await onlyPayment(other);
    expect(await voidIt(otherId, "Entered twice")).toMatchObject({ ok: true });
    expect(await voidIt(otherId, "Entered twice")).toEqual({ ok: true, message: "Payment voided" });
    expect(await prisma.auditEvent.count({ where: { storeId, targetId: otherId } })).toBe(1);
  });

  it("changes nothing when the replacement fails to save", async () => {
    const orderId = await makeOrder("READY", 500_000);
    await record(orderId, "5,000");
    const originalId = await onlyPayment(orderId);

    // A replacement the database refuses (a Paystack method on a store
    // payment), sent past the action's checks.
    await expect(
      voidStorePayment(
        storeId,
        {
          paymentId: originalId,
          actorUserId: users.owner.id,
          reason: "Wrong amount",
          replacement: {
            clientRequestId: randomUUID(),
            details: { amount: 400_000, method: "PAYSTACK", reference: null, note: null },
          },
        },
        () => ({ kind: "void" }),
        new Date(),
      ),
    ).rejects.toThrow();

    const payments = await paymentsOf(orderId);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: "CONFIRMED", voidedAt: null, voidedByUserId: null, voidReason: null });
    expect(await prisma.auditEvent.count({ where: { storeId, targetId: originalId } })).toBe(0);
    expect(await balanceOf(orderId)).toMatchObject({ state: "PAID" });
  });

  it("never voids a Paystack payment", async () => {
    const orderId = await makeOrder();
    const online = await prisma.payment.create({
      data: {
        storeId,
        orderId,
        amount: 500_000,
        source: "ONLINE",
        method: "PAYSTACK",
        status: "CONFIRMED",
        paystackReference: `test-${randomUUID()}`,
        confirmedAt: new Date(),
      },
      select: { id: true },
    });
    expect(await voidIt(online.id, "Customer asked")).toMatchObject({ ok: false, code: "ONLINE_PAYMENT" });
    expect(await voidIt(online.id, "Customer asked", { replace: { amount: "1,000" } })).toMatchObject({
      ok: false,
      code: "ONLINE_PAYMENT",
    });
    expect((await paymentsOf(orderId))[0].status).toBe("CONFIRMED");
  });

  it("lets exactly one of two owners voiding at once succeed", async () => {
    const orderId = await makeOrder();
    await record(orderId, "5,000");
    const paymentId = await onlyPayment(orderId);
    const input = { mode: "VOID_ONLY" as const, paymentId, reason: "Entered twice" };

    const results = await Promise.all([
      voidPaymentAsService({ storeId, userId: users.owner.id }, input, new Date()),
      voidPaymentAsService({ storeId, userId: users.secondOwner.id }, input, new Date()),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: "ALREADY_VOIDED" });
    expect(await prisma.auditEvent.count({ where: { storeId, targetId: paymentId } })).toBe(1);
  });

  it("voids a payment on a cancelled order, and records its correction", async () => {
    const orderId = await makeOrder("READY", 500_000);
    await record(orderId, "5,000");
    await prisma.order.update({ where: { id: orderId }, data: { stage: "CANCELLED", cancelledAt: new Date() } });
    expect(await balanceOf(orderId)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -500_000 });

    const paymentId = await onlyPayment(orderId);
    expect(await voidIt(paymentId, "Was ₦4,000", { replace: { amount: "4,000", confirmedExcess: 400_000 } })).toMatchObject({
      ok: true,
    });
    expect(await balanceOf(orderId)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -400_000 });
  });
});

describe("store access", () => {
  it("refuses recording and voiding when the store can't work on existing orders", async () => {
    const orderId = await makeOrder();
    await record(orderId, "1,000");
    const paymentId = await onlyPayment(orderId);

    await prisma.store.update({ where: { id: storeId }, data: { status: "DEACTIVATED" } });
    try {
      expect(await record(orderId, "1,000")).toMatchObject({ ok: false, code: "NOT_ALLOWED_FOR_STORE" });
      expect(await voidIt(paymentId, "Entered twice")).toMatchObject({ ok: false, code: "NOT_ALLOWED_FOR_STORE" });
    } finally {
      await prisma.store.update({ where: { id: storeId }, data: { status: "ACTIVE" } });
    }
    expect(await paymentsOf(orderId)).toMatchObject([{ status: "CONFIRMED" }]);
  });

  it("won't let a FreshFold owner record or void on a CleanWave order, even by sending its ID", async () => {
    const before = await prisma.payment.findMany({ where: { orderId: cleanWave.orderId }, orderBy: { id: "asc" } });

    expect(await record(cleanWave.orderId, "1,000", { as: freshFoldOwner })).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Order not found.",
    });
    expect(await voidIt(cleanWave.paymentId, "Not ours", { as: freshFoldOwner })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      await voidIt(cleanWave.paymentId, "Not ours", { as: freshFoldOwner, replace: { amount: "1,000" } }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });

    expect(await prisma.payment.findMany({ where: { orderId: cleanWave.orderId }, orderBy: { id: "asc" } })).toEqual(before);
  });
});
