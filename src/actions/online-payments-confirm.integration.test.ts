import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { POST as webhookPOST } from "@/app/api/webhooks/paystack/route";
import { CLIENT_IP_HEADER } from "@/lib/client-ip";
import { getPaystackConfig } from "@/lib/env";
import { MISMATCH_CODES } from "@/lib/online-payment";
import { PAYMENT_STATES } from "@/lib/orders";
import { toMatchKey } from "@/lib/match-key";
import { hashToken } from "@/lib/tokens";
import { DEFAULT_ORDER_LIST_FILTERS } from "@/schemas/orders";
import type { BookingRequest } from "@/schemas/booking";
import type { PaystackTransaction } from "@/schemas/online-payments";
import { getPrisma } from "@/server/data/client";
import { listOrders } from "@/server/data/orders";
import { getBalance } from "@/server/domain/balance";
import { buildOrderListQuery } from "@/server/domain/order-list";
import { PaystackError } from "@/server/integrations/paystack-error";
import { confirmPaystackPayment, reconcilePendingPayments } from "@/server/services/online-payments";
import { getOrderDetail } from "@/server/services/orders";
import { loadTrackingPage } from "@/server/services/tracking";
import { createTestPrisma } from "@/test/integration/db";
import { fakeMailer, fakePaystack } from "@/test/integration/fakes";

import { createBooking } from "./booking";
import { confirmReturnedPayment, startOnlinePayment } from "./online-payments";

// Confirming online payments (Feature 17, Phase 4, plan 13.2): the webhook,
// the return verify, and the reconciliation job, all through one function
// that counts each payment once. Paystack is the fake client.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

vi.setConfig({ testTimeout: 90_000 });

const SUBACCOUNT = "ACCT_phase4test";
const OTHER_SUBACCOUNT = "ACCT_phase4other";
const ALERT_EMAIL = "alerts@example.com";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let prisma: PrismaClient;
let store: TestStore;
let other: TestStore;

interface TestStore {
  id: string;
  slug: string;
  orderPrefix: string;
  timeZone: string;
  shirt: string; // ₦800 each
}

beforeAll(async () => {
  prisma = createTestPrisma();
  [store, other] = await Promise.all([createStore("Confirm Test Laundry", "CT", SUBACCOUNT), createStore("Other Confirm Laundry", "OC", OTHER_SUBACCOUNT)]);
}, 120_000);

beforeEach(() => {
  fakePaystack.reset();
  fakeMailer.reset();
  request.headers = new Headers({ [CLIENT_IP_HEADER]: newIp() });
});

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, payments, or customers.
  for (const each of [store, other]) {
    const where = { storeId: each.id };
    await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
    await prisma.$transaction(
      [
        prisma.payment.deleteMany({ where }),
        prisma.auditEvent.deleteMany({ where }),
        prisma.messageEvent.deleteMany({ where }),
        prisma.statusEvent.deleteMany({ where }),
        prisma.quoteRevision.deleteMany({ where }),
        prisma.orderLine.deleteMany({ where }),
        prisma.notification.deleteMany({ where }),
        prisma.order.deleteMany({ where }),
        prisma.customer.deleteMany({ where }),
        prisma.service.deleteMany({ where }),
        prisma.subscription.deleteMany({ where }),
        prisma.store.delete({ where: { id: each.id } }),
      ],
      { maxWait: 15_000, timeout: 30_000 },
    );
  }
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

// Connected, pay later off, email copies off: every fixed-price booking is Book and pay.
async function createStore(name: string, orderPrefix: string, subaccount: string): Promise<TestStore> {
  const slug = `confirm-test-${randomUUID().slice(0, 8)}`;
  const { id, timeZone } = await prisma.store.create({
    data: {
      name,
      slug,
      orderPrefix,
      dropOffEnabled: true,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      openTime: "08:00",
      closeTime: "17:00",
      paystackSubaccountCode: subaccount,
      emailCopiesEnabled: false,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
    },
    select: { id: true, timeZone: true },
  });
  const shirt = await prisma.service.create({
    data: { storeId: id, name: "Shirt", nameKey: toMatchKey("Shirt"), pricingType: "PER_ITEM", price: 80_000 },
    select: { id: true },
  });
  return { id, slug, orderPrefix, timeZone, shirt: shirt.id };
}

function newPhone(): string {
  return `+234803${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

function newIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

interface Booked {
  token: string;
  orderId: string;
  paymentId: string;
  reference: string;
}

// A Book and pay booking for `shirts` shirts: the order and its PENDING payment.
async function bookAndPay(at: TestStore = store, shirts = 2): Promise<Booked> {
  const booking: BookingRequest = {
    clientRequestId: randomUUID(),
    serviceLines: [{ serviceId: at.shirt, amount: String(shirts) }],
    fulfilmentType: "DROP_OFF",
    pickup: null,
    customer: { name: "Amina Bello", phone: newPhone(), email: "amina@example.com" },
  };
  const result = await createBooking(at.slug, booking);
  if (!result.ok || !result.trackingUrl) throw new Error("The booking failed");
  const token = result.trackingUrl.split("/o/")[1];
  const order = await prisma.order.findUniqueOrThrow({
    where: { trackingTokenHash: hashToken(token) },
    select: { id: true, payments: { select: { id: true, paystackReference: true }, orderBy: { createdAt: "desc" } } },
  });
  const [payment] = order.payments;
  if (!payment?.paystackReference) throw new Error("Book and pay should start a payment");
  return { token, orderId: order.id, paymentId: payment.id, reference: payment.paystackReference };
}

// What Paystack reports for a successful payment, as verify and charge.success carry it.
function success(booked: Booked, change: Partial<PaystackTransaction> = {}): PaystackTransaction {
  const sent = fakePaystack.transactions.get(booked.reference);
  return {
    status: "success",
    reference: booked.reference,
    amountKobo: sent?.amountKobo ?? 160_000,
    currency: "NGN",
    domain: "test",
    paidAt: new Date(),
    feesKobo: 2_400,
    subaccountCode: sent?.subaccountCode ?? SUBACCOUNT,
    ...change,
  };
}

// A signed charge.success, as Paystack posts it.
function webhook(txn: PaystackTransaction, key?: string): Request {
  const body = JSON.stringify({
    event: "charge.success",
    data: {
      status: txn.status,
      reference: txn.reference,
      amount: txn.amountKobo,
      currency: txn.currency,
      domain: txn.domain,
      paid_at: txn.paidAt?.toISOString() ?? null,
      fees: txn.feesKobo,
      subaccount: txn.subaccountCode ? { subaccount_code: txn.subaccountCode } : {},
      customer: { email: "amina@example.com" },
    },
  });
  const secret = key ?? getPaystackConfig()?.secretKey ?? "";
  return new Request("http://localhost:3000/api/webhooks/paystack", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", secret).update(body).digest("hex") },
  });
}

async function paymentOf(id: string) {
  return prisma.payment.findUniqueOrThrow({ where: { id } });
}

// The staff bell's payment notifications for one payment.
async function paymentNotifications(paymentId: string) {
  return prisma.notification.findMany({
    where: { sourceId: paymentId },
    select: { storeId: true, type: true, audience: true },
  });
}

async function audits(paymentId: string, action: string) {
  return prisma.auditEvent.findMany({ where: { targetId: paymentId, action } });
}

async function balanceOf(orderId: string) {
  return getBalance(
    await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        stage: true,
        channel: true,
        payLater: true,
        approvedQuote: { select: { total: true } },
        payments: { select: { amount: true, status: true, voidedAt: true } },
        refunds: { select: { amount: true, voidedAt: true } },
      },
    }),
  );
}

describe("the webhook", () => {
  it("confirms a payment once, however many times the same signed event arrives", async () => {
    const booked = await bookAndPay();
    const event = success(booked);

    expect((await webhookPOST(webhook(event))).status).toBe(200);
    expect((await webhookPOST(webhook(event))).status).toBe(200);

    expect(await paymentOf(booked.paymentId)).toMatchObject({ status: "CONFIRMED", paystackFeeAmount: 2_400 });
    expect(await audits(booked.paymentId, "ONLINE_PAYMENT_CONFIRMED")).toHaveLength(1);
    expect(await balanceOf(booked.orderId)).toMatchObject({ state: "PAID", balanceKobo: 0 });
    // One "payment received" for owners and staff, however many webhooks arrive.
    expect(await paymentNotifications(booked.paymentId)).toEqual([
      { storeId: store.id, type: "PAYMENT_RECEIVED", audience: "STAFF_AND_OWNERS" },
    ]);
  });

  it("refuses a bad signature and writes nothing", async () => {
    const booked = await bookAndPay();
    const response = await webhookPOST(webhook(success(booked), "sk_test_not_the_key"));
    expect(response.status).toBe(401);
    expect(await paymentOf(booked.paymentId)).toMatchObject({ status: "PENDING" });
  });

  it("answers 200 for an unknown reference and writes nothing", async () => {
    const before = await prisma.auditEvent.count({ where: { action: { startsWith: "ONLINE_PAYMENT" } } });
    const unknown = { ...success({ token: "", orderId: "", paymentId: "", reference: "FL-ffffffffffffffffffff" }) };
    expect((await webhookPOST(webhook(unknown))).status).toBe(200);
    expect(await prisma.auditEvent.count({ where: { action: { startsWith: "ONLINE_PAYMENT" } } })).toBe(before);
  });
});

describe("counting each payment once", () => {
  it("lets exactly one of a webhook and a verify racing confirm it", async () => {
    const booked = await bookAndPay();
    const outcomes = await Promise.all([confirmPaystackPayment(success(booked), new Date()), confirmPaystackPayment(success(booked), new Date())]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["ALREADY_HANDLED", "CONFIRMED"]);
    expect(await audits(booked.paymentId, "ONLINE_PAYMENT_CONFIRMED")).toHaveLength(1);
    expect(await paymentNotifications(booked.paymentId)).toHaveLength(1);
    expect(await balanceOf(booked.orderId)).toMatchObject({ confirmedPaymentsKobo: 160_000 });
  });

  it("confirms a failed attempt with no code, or a non-mismatch code, when Paystack later reports success", async () => {
    for (const failureCode of [null, "PAYSTACK_ABANDONED", "initialize HTTP 500"]) {
      const booked = await bookAndPay();
      await prisma.payment.update({ where: { id: booked.paymentId }, data: { status: "FAILED", failureCode } });
      expect(await confirmPaystackPayment(success(booked), new Date())).toEqual({ kind: "CONFIRMED" });
      expect(await paymentOf(booked.paymentId)).toMatchObject({ status: "CONFIRMED" });
    }
  });
});

describe("mismatched payments", () => {
  it("refuses a different amount: not counted, reviewed once, one alert, and shown to staff", async () => {
    const booked = await bookAndPay();
    const wrong = success(booked, { amountKobo: 100 });

    expect(await confirmPaystackPayment(wrong, new Date())).toEqual({ kind: "MISMATCH", code: "AMOUNT_MISMATCH", recorded: true });
    expect(await paymentOf(booked.paymentId)).toMatchObject({ status: "FAILED", failureCode: "AMOUNT_MISMATCH", confirmedAt: null });
    expect(await audits(booked.paymentId, "ONLINE_PAYMENT_NEEDS_REVIEW")).toHaveLength(1);
    const alerts = fakeMailer.sent.filter((message) => message.to === ALERT_EMAIL);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toContain("AMOUNT_MISMATCH");
    expect(alerts[0].text).toContain(booked.reference);
    expect(await balanceOf(booked.orderId)).toMatchObject({ confirmedPaymentsKobo: 0, balanceKobo: 160_000 });

    // A repeated webhook changes nothing and sends no second alert.
    expect((await webhookPOST(webhook(wrong))).status).toBe(200);
    expect(await audits(booked.paymentId, "ONLINE_PAYMENT_NEEDS_REVIEW")).toHaveLength(1);
    expect(fakeMailer.sent.filter((message) => message.to === ALERT_EMAIL)).toHaveLength(1);
    // One "needs review", for owners only; never "payment received".
    expect(await paymentNotifications(booked.paymentId)).toEqual([
      { storeId: store.id, type: "PAYMENT_NEEDS_REVIEW", audience: "OWNERS_ONLY" },
    ]);

    // Staff see it as "Payment needs review", never as counted.
    const detail = await getOrderDetail(store.id, booked.orderId, "OWNER");
    expect(detail?.order.payments.find((payment) => payment.id === booked.paymentId)).toMatchObject({
      status: "FAILED",
      failureCode: "AMOUNT_MISMATCH",
    });
  });

  it.each(MISMATCH_CODES)("never confirms a payment failed with %s, even for a matching retry", async (code) => {
    const booked = await bookAndPay();
    await prisma.payment.update({ where: { id: booked.paymentId }, data: { status: "FAILED", failureCode: code } });

    expect((await webhookPOST(webhook(success(booked)))).status).toBe(200);
    expect(await confirmPaystackPayment(success(booked), new Date())).toEqual({ kind: "ALREADY_HANDLED" });
    expect(await paymentOf(booked.paymentId)).toMatchObject({ status: "FAILED", failureCode: code });
    expect(await balanceOf(booked.orderId)).toMatchObject({ confirmedPaymentsKobo: 0 });
    expect(fakeMailer.sent.filter((message) => message.to === ALERT_EMAIL)).toHaveLength(0);
  });

  it("refuses the other mode, another currency, and another store's subaccount", async () => {
    const cases = [
      [{ domain: "live" as const }, "MODE_MISMATCH"],
      [{ currency: "USD" }, "CURRENCY_MISMATCH"],
      [{ subaccountCode: OTHER_SUBACCOUNT }, "SUBACCOUNT_MISMATCH"],
    ] as const;
    for (const [change, code] of cases) {
      const booked = await bookAndPay();
      expect(await confirmPaystackPayment(success(booked, change), new Date())).toMatchObject({ kind: "MISMATCH", code });
    }
  });
});

describe("late payments", () => {
  it("records a payment that arrives after the order was cancelled: Refund owed, link still valid", async () => {
    const booked = await bookAndPay();
    await prisma.order.update({ where: { id: booked.orderId }, data: { stage: "CANCELLED", cancelledAt: new Date() } });

    expect(await confirmPaystackPayment(success(booked), new Date())).toEqual({ kind: "CONFIRMED" });
    expect(await balanceOf(booked.orderId)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -160_000 });
    expect(await audits(booked.paymentId, "ONLINE_PAYMENT_CONFIRMED")).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ receivedAfter: "CANCELLED" }) }),
    ]);
    expect((await loadTrackingPage(booked.token, new Date())).kind).toBe("VALID");
  });

  it("records an extra payment on a fully paid order as Refund owed, and the timeline says why", async () => {
    const booked = await bookAndPay();
    await confirmPaystackPayment(success(booked), new Date());
    const again = await startOnlinePayment(booked.token, { email: "amina@example.com" });
    // Nothing is due any more, so Pay now refuses a second attempt.
    expect(again).toMatchObject({ ok: false });

    // Two tabs: a second attempt started before the first was confirmed.
    const second = await prisma.payment.create({
      data: {
        storeId: store.id,
        orderId: booked.orderId,
        amount: 160_000,
        source: "ONLINE",
        method: "PAYSTACK",
        status: "PENDING",
        paystackReference: "FL-0000000000000000aaaa",
      },
    });
    const secondBooked = { ...booked, paymentId: second.id, reference: "FL-0000000000000000aaaa" };
    expect(await confirmPaystackPayment(success(secondBooked, { amountKobo: 160_000 }), new Date())).toEqual({ kind: "CONFIRMED" });
    expect(await balanceOf(booked.orderId)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -160_000 });

    const detail = await getOrderDetail(store.id, booked.orderId, "OWNER");
    const entries = detail?.timeline.filter((entry) => entry.kind === "payment") ?? [];
    expect(entries.map((entry) => entry.kind === "payment" && entry.payment.receivedAfter).sort()).toEqual(["PAID", null].sort());
  });
});

describe("back from Paystack", () => {
  it("confirms on return when Paystack says success, and says Pending while it is in progress", async () => {
    const booked = await bookAndPay();
    fakePaystack.verifyStatus.set(booked.reference, "ongoing");
    expect(await confirmReturnedPayment(booked.token, booked.reference)).toBe("PENDING");
    expect(await paymentOf(booked.paymentId)).toMatchObject({ status: "PENDING" });

    fakePaystack.verifyStatus.set(booked.reference, "success");
    expect(await confirmReturnedPayment(booked.token, booked.reference)).toBe("CONFIRMED");
    expect(await paymentOf(booked.paymentId)).toMatchObject({ status: "CONFIRMED" });

    // The webhook arriving afterwards changes nothing.
    expect((await webhookPOST(webhook(success(booked)))).status).toBe(200);
    expect(await audits(booked.paymentId, "ONLINE_PAYMENT_CONFIRMED")).toHaveLength(1);
  });

  it("never checks a reference through another store's link", async () => {
    const mine = await bookAndPay(store);
    const theirs = await bookAndPay(other);
    fakePaystack.verifyStatus.set(mine.reference, "success");
    fakePaystack.calls.length = 0;

    expect(await confirmReturnedPayment(theirs.token, mine.reference)).toBe("NOT_CONFIRMED");
    expect(await confirmReturnedPayment("A".repeat(43), mine.reference)).toBe("NOT_CONFIRMED");
    expect(await confirmReturnedPayment(mine.token, "not a reference")).toBe("NOT_CONFIRMED");
    expect(fakePaystack.calls).not.toContain("verifyTransaction");
    expect(await paymentOf(mine.paymentId)).toMatchObject({ status: "PENDING" });
  });
});

describe("the reconciliation job", () => {
  it("fails abandoned attempts, confirms paid ones once, and expires anything older than 48 hours", async () => {
    const now = new Date();
    const [abandoned, paid, expired] = [await bookAndPay(), await bookAndPay(), await bookAndPay()];
    // The oldest pending attempts in the window are checked first.
    await prisma.payment.update({ where: { id: abandoned.paymentId }, data: { createdAt: new Date(now.getTime() - 47 * HOUR) } });
    await prisma.payment.update({ where: { id: paid.paymentId }, data: { createdAt: new Date(now.getTime() - 46 * HOUR) } });
    await prisma.payment.update({ where: { id: expired.paymentId }, data: { createdAt: new Date(now.getTime() - 49 * HOUR) } });
    fakePaystack.verifyStatus.set(abandoned.reference, "abandoned");
    fakePaystack.verifyStatus.set(paid.reference, "success");

    const result = await reconcilePendingPayments(now);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await paymentOf(abandoned.paymentId)).toMatchObject({ status: "FAILED", failureCode: "PAYSTACK_ABANDONED" });
    expect(await paymentOf(paid.paymentId)).toMatchObject({ status: "CONFIRMED" });
    expect(await paymentOf(expired.paymentId)).toMatchObject({ status: "FAILED", failureCode: "EXPIRED" });

    // Run again: nothing is confirmed twice.
    await reconcilePendingPayments(now);
    expect(await audits(paid.paymentId, "ONLINE_PAYMENT_CONFIRMED")).toHaveLength(1);

    // A late webhook still confirms an expired attempt: the money arrived.
    expect(await confirmPaystackPayment(success(expired), now)).toEqual({ kind: "CONFIRMED" });
  });

  it("leaves recent attempts alone", async () => {
    const booked = await bookAndPay();
    fakePaystack.verifyStatus.set(booked.reference, "abandoned");
    await reconcilePendingPayments(new Date());
    expect(await paymentOf(booked.paymentId)).toMatchObject({ status: "PENDING" });
  });
});

describe("payment states", () => {
  it("shows Payment required after a failed start, Pending while a payment is started, and Paid once confirmed", async () => {
    fakePaystack.failNext.initializeTransaction = new PaystackError("HTTP 500");
    const booked = await bookAndPay();
    expect(await balanceOf(booked.orderId)).toMatchObject({ state: "PAYMENT_REQUIRED" });
    const page = await loadTrackingPage(booked.token, new Date());
    expect(page.kind === "VALID" && page.view.payment).toBe("Payment due: ₦1,600");

    await startOnlinePayment(booked.token, { email: "amina@example.com" });
    expect(await balanceOf(booked.orderId)).toMatchObject({ state: "PENDING", balanceKobo: 160_000 });
    const detail = await getOrderDetail(store.id, booked.orderId, "STAFF");
    expect(detail?.payments.hasPendingOnlinePayment).toBe(true);

    const pending = await prisma.payment.findFirstOrThrow({ where: { orderId: booked.orderId, status: "PENDING" } });
    await confirmPaystackPayment(success({ ...booked, paymentId: pending.id, reference: pending.paystackReference ?? "" }), new Date());
    expect(await balanceOf(booked.orderId)).toMatchObject({ state: "PAID" });
    expect((await getOrderDetail(store.id, booked.orderId, "STAFF"))?.payments.hasPendingOnlinePayment).toBe(false);
  });

  it("keeps an unpaid staff-entered order Outstanding, never Payment required", async () => {
    fakePaystack.failNext.initializeTransaction = new PaystackError("HTTP 500");
    const booked = await bookAndPay();
    await prisma.order.update({ where: { id: booked.orderId }, data: { channel: "COUNTER", payLater: false } });
    expect(await balanceOf(booked.orderId)).toMatchObject({ state: "OUTSTANDING" });
  });

  it("agrees with the orders list filter on every order in these stores", async () => {
    for (const checked of [store, other]) {
      const all = await prisma.order.findMany({
        where: { storeId: checked.id },
        select: {
          id: true,
          stage: true,
          channel: true,
          payLater: true,
          approvedQuote: { select: { total: true } },
          payments: { select: { amount: true, status: true, voidedAt: true } },
          refunds: { select: { amount: true, voidedAt: true } },
        },
      });
      const states = new Set(all.map((order) => getBalance(order).state));
      // This file's orders cover the new states.
      if (checked === store) expect([...states]).toEqual(expect.arrayContaining(["PAYMENT_REQUIRED", "PENDING", "PAID", "REFUND_OWED", "OUTSTANDING"]));
      for (const state of PAYMENT_STATES) {
        const expected = all.filter((order) => getBalance(order).state === state).map((order) => order.id);
        const query = buildOrderListQuery({ ...DEFAULT_ORDER_LIST_FILTERS, payment: state }, checked, new Date());
        const { orders: found } = await listOrders(checked.id, query, 1000);
        expect(found.map((order) => order.id).sort(), `${state} at ${checked.orderPrefix}`).toEqual(expected.sort());
      }
    }
  });
});
