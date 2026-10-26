import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { CLIENT_IP_HEADER } from "@/lib/client-ip";
import { toMatchKey } from "@/lib/match-key";
import { hashToken } from "@/lib/tokens";
import type { BookingRequest } from "@/schemas/booking";
import { getPrisma } from "@/server/data/client";
import { PaystackError } from "@/server/integrations/paystack-error";
import { loadBookingPage } from "@/server/services/booking";
import { isPaymentBeingConfirmed, loadTrackingPage } from "@/server/services/tracking";
import { createTestPrisma } from "@/test/integration/db";
import { fakePaystack } from "@/test/integration/fakes";

import { createBooking, type BookingActionResult } from "./booking";
import { startOnlinePayment } from "./online-payments";

// Starting online payments (Feature 17, Phase 3): Pay now on the tracking
// page, and Book and pay. Paystack is the fake client: nothing here calls
// Paystack, and nothing confirms a payment (Phase 4).

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

vi.setConfig({ testTimeout: 90_000 });

let prisma: PrismaClient;
// Connected, pay later off, email copies off.
let connected: TestStore;
// Connected, pay later on.
let payLater: TestStore;
// Not connected.
let unconnected: TestStore;
// Connected, pay later off: its Fluta fee rate changes in the fee tests.
let feeStore: TestStore;

interface TestStore {
  id: string;
  slug: string;
  shirt: string; // ₦800 each, fixed price
  inspect: string; // priced by the store
}

beforeAll(async () => {
  prisma = createTestPrisma();
  [connected, payLater, unconnected, feeStore] = await Promise.all([
    createStore("Paystack Test Laundry", "PT", { paystackSubaccountCode: "ACCT_phase3test", emailCopiesEnabled: false }),
    createStore("Pay Later Laundry", "PL", { paystackSubaccountCode: "ACCT_phase3later", payLaterEnabled: true }),
    createStore("Unconnected Laundry", "UC", {}),
    createStore("Fee Test Laundry", "FT", { paystackSubaccountCode: "ACCT_phase5fee", emailCopiesEnabled: false }),
  ]);
}, 120_000);

beforeEach(() => {
  fakePaystack.reset();
  request.headers = new Headers({ [CLIENT_IP_HEADER]: newIp() });
});

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, payments, or customers.
  for (const store of [connected, payLater, unconnected, feeStore]) {
    const where = { storeId: store.id };
    await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
    await prisma.$transaction(
      [
        prisma.payment.deleteMany({ where }),
        prisma.auditEvent.deleteMany({ where }),
        prisma.messageEvent.deleteMany({ where }),
        prisma.statusEvent.deleteMany({ where }),
        prisma.quoteRevision.deleteMany({ where }),
        prisma.orderLine.deleteMany({ where }),
        prisma.order.deleteMany({ where }),
        prisma.customer.deleteMany({ where }),
        prisma.service.deleteMany({ where }),
        prisma.subscription.deleteMany({ where }),
        prisma.store.delete({ where: { id: store.id } }),
      ],
      { maxWait: 15_000, timeout: 30_000 },
    );
  }
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function createStore(
  name: string,
  orderPrefix: string,
  payments: { paystackSubaccountCode?: string; payLaterEnabled?: boolean; emailCopiesEnabled?: boolean },
): Promise<TestStore> {
  const slug = `paystack-test-${randomUUID().slice(0, 8)}`;
  const { id } = await prisma.store.create({
    data: {
      name,
      slug,
      orderPrefix,
      dropOffEnabled: true,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      openTime: "08:00",
      closeTime: "17:00",
      ...payments,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
    },
    select: { id: true },
  });
  const service = (serviceName: string, price: number, requiresQuote: boolean) =>
    prisma.service.create({
      data: { storeId: id, name: serviceName, nameKey: toMatchKey(serviceName), pricingType: "PER_ITEM", price, requiresQuote },
      select: { id: true },
    });
  const [shirt, inspect] = await Promise.all([service("Shirt", 80_000, false), service("Agbada", 500_000, true)]);
  return { id, slug, shirt: shirt.id, inspect: inspect.id };
}

function newPhone(): string {
  return `+234803${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

function newIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

// Two shirts (₦1,600), dropped off.
function booking(store: TestStore, overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    clientRequestId: randomUUID(),
    serviceLines: [{ serviceId: store.shirt, amount: "2" }],
    fulfilmentType: "DROP_OFF",
    pickup: null,
    customer: { name: "Amina Bello", phone: newPhone(), email: "amina@example.com" },
    ...overrides,
  };
}

async function book(store: TestStore, request: BookingRequest): Promise<Extract<BookingActionResult, { ok: true }> & { token: string }> {
  const result = await createBooking(store.slug, request);
  if (!result.ok) throw new Error(`The booking failed: ${result.code}`);
  if (!result.trackingUrl) throw new Error("The booking has no link");
  return { ...result, token: result.trackingUrl.split("/o/")[1] };
}

async function orderOf(store: TestStore, clientRequestId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { storeId_clientRequestId: { storeId: store.id, clientRequestId } },
    select: { id: true, payLater: true, customerId: true, payments: true, messageEvents: true },
  });
}

describe("Book and pay", () => {
  it("creates the order, saves a PENDING payment, and goes straight to Paystack's checkout", async () => {
    const request = booking(connected);
    const result = await book(connected, request);

    expect(result.payment).toMatchObject({ kind: "CHECKOUT" });
    if (result.payment?.kind !== "CHECKOUT") throw new Error("Expected checkout");
    expect(result.payment.checkoutUrl.startsWith("https://checkout.paystack.com/")).toBe(true);

    const order = await orderOf(connected, request.clientRequestId);
    expect(order.payLater).toBe(false);
    expect(order.payments).toHaveLength(1);
    const [payment] = order.payments;
    expect(payment).toMatchObject({
      source: "ONLINE",
      method: "PAYSTACK",
      status: "PENDING",
      amount: 160_000,
      payerEmail: "amina@example.com",
      flutaFeeBps: 0,
      flutaFeeAmount: 0,
      confirmedAt: null,
    });
    expect(payment.paystackReference).toMatch(/^FL-[0-9a-f]{20}$/);

    // What Paystack was asked for: the store's subaccount, Fluta's charge
    // (0), and the order page to come back to.
    const sent = fakePaystack.transactions.get(payment.paystackReference ?? "");
    expect(sent).toMatchObject({
      amountKobo: 160_000,
      email: "amina@example.com",
      currency: "NGN",
      subaccountCode: "ACCT_phase3test",
      transactionChargeKobo: 0,
      callbackUrl: `${result.trackingUrl}?paystack=return`,
    });
    expect(sent?.metadata).toMatchObject({ payment_id: payment.id, order_id: order.id, store_id: connected.id, cancel_action: result.trackingUrl });
    // The token appears only in the two return URLs, never in the IDs or custom fields.
    const { payment_id, order_id, store_id, custom_fields } = sent?.metadata ?? {};
    expect(JSON.stringify({ payment_id, order_id, store_id, custom_fields })).not.toContain(result.token);
  });

  it("always emails the order link to the typed email, even with email copies off", async () => {
    const phone = newPhone();
    await prisma.customer.create({ data: { storeId: connected.id, name: "Chidi Okeke", phone, email: "chidi@example.com" } });
    const request = booking(connected, { customer: { name: "Chidi Okeke", phone, email: "chidi.new@example.com" } });
    await book(connected, request);

    const order = await orderOf(connected, request.clientRequestId);
    const emails = order.messageEvents.filter((message) => message.channel === "EMAIL");
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ template: "LINK_CREATED", recipient: "chidi.new@example.com" });
    // The saved email is never overwritten.
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId } });
    expect(customer.email).toBe("chidi@example.com");
  });

  it("requires an email on this path, and creates nothing without one", async () => {
    const request = booking(connected, { customer: { name: "Amina Bello", phone: newPhone(), email: "" } });
    const result = await createBooking(connected.slug, request);
    expect(result).toMatchObject({ ok: false, code: "EMAIL_REQUIRED", step: "details", fieldErrors: { "customer.email": expect.any(String) } });
    expect(await prisma.order.count({ where: { storeId: connected.id, clientRequestId: request.clientRequestId } })).toBe(0);
    expect(fakePaystack.calls).not.toContain("initializeTransaction");
  });

  it("starts no second payment on a repeated submit while the first is pending", async () => {
    const request = booking(connected);
    await book(connected, request);
    const again = await book(connected, request);

    expect(again.payment).toEqual({ kind: "PENDING" });
    const order = await orderOf(connected, request.clientRequestId);
    expect(order.payments).toHaveLength(1);
    expect(fakePaystack.calls.filter((call) => call === "initializeTransaction")).toHaveLength(1);
  });

  it("keeps the booking when Paystack fails, and Pay now on its link tries again", async () => {
    fakePaystack.failNext.initializeTransaction = new PaystackError("HTTP 500");
    const request = booking(connected);
    const result = await book(connected, request);

    expect(result.payment).toMatchObject({ kind: "FAILED", token: result.token });
    const order = await orderOf(connected, request.clientRequestId);
    expect(order.payLater).toBe(false);
    expect(order.payments).toEqual([expect.objectContaining({ status: "FAILED", failureCode: "initialize HTTP 500", confirmedAt: null })]);

    const retry = await startOnlinePayment(result.token, { email: "amina@example.com" });
    expect(retry).toMatchObject({ ok: true, checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.paystack\.com\//) });
    const after = await orderOf(connected, request.clientRequestId);
    expect(after.payments.map((payment) => payment.status).sort()).toEqual(["FAILED", "PENDING"]);
  });

  it("is never offered for a booking the store still has to price", async () => {
    const request = booking(connected, {
      serviceLines: [{ serviceId: connected.inspect, amount: "1" }],
      customer: { name: "Amina Bello", phone: newPhone(), email: "" },
    });
    const result = await book(connected, request);
    expect(result.payment).toBeNull();
    expect((await orderOf(connected, request.clientRequestId)).payLater).toBe(true);
    expect(fakePaystack.calls).toEqual([]);
  });

  it("is never offered at a store with pay later on: the email stays optional", async () => {
    const page = await loadBookingPageOptions(payLater);
    expect(page.payAtBooking).toBe(false);
    const request = booking(payLater, { customer: { name: "Amina Bello", phone: newPhone(), email: "" } });
    const result = await book(payLater, request);
    expect(result.payment).toBeNull();
    expect((await orderOf(payLater, request.clientRequestId)).payLater).toBe(true);
    expect(fakePaystack.calls).toEqual([]);
  });

  it("is offered on the booking page only at a connected store with pay later off", async () => {
    expect((await loadBookingPageOptions(connected)).payAtBooking).toBe(true);
    expect((await loadBookingPageOptions(unconnected)).payAtBooking).toBe(false);
  });
});

async function loadBookingPageOptions(store: TestStore) {
  const page = await loadBookingPage(store.slug, new Date());
  if (!page) throw new Error("The booking page should load");
  return page.options;
}

describe("Fluta's fee", () => {
  // Fluta admins set the rate (Feature 23); the tests set it directly.
  async function setFeeRate(onlineFeeBps: number) {
    await prisma.store.update({ where: { id: feeStore.id }, data: { onlineFeeBps } });
  }

  async function paymentsByReference(storeId: string) {
    const payments = await prisma.payment.findMany({ where: { storeId }, select: { id: true, paystackReference: true, flutaFeeBps: true, flutaFeeAmount: true } });
    return new Map(payments.map((payment) => [payment.paystackReference ?? "", payment]));
  }

  it("takes the store's rate when the payment starts, sends it to Paystack, and copies it to the payment", async () => {
    await setFeeRate(150);
    const request = booking(feeStore);
    await book(feeStore, request);

    const [payment] = (await orderOf(feeStore, request.clientRequestId)).payments;
    // 1.5% of ₦1,600 is ₦24.
    expect(payment).toMatchObject({ status: "PENDING", amount: 160_000, flutaFeeBps: 150, flutaFeeAmount: 2_400 });
    expect(fakePaystack.transactions.get(payment.paystackReference ?? "")).toMatchObject({
      amountKobo: 160_000,
      subaccountCode: "ACCT_phase5fee",
      transactionChargeKobo: 2_400,
    });
  });

  it("keeps each payment's copied rate and amount when the rate changes later", async () => {
    await setFeeRate(150);
    const first = booking(feeStore);
    const firstBooking = await book(feeStore, first);
    await setFeeRate(500);
    const second = booking(feeStore);
    await book(feeStore, second);
    // Back to 0%, then Pay now on the first order starts a new attempt.
    await setFeeRate(0);
    expect(await startOnlinePayment(firstBooking.token, { email: "amina@example.com" })).toMatchObject({ ok: true });

    const firstPayments = (await orderOf(feeStore, first.clientRequestId)).payments;
    const secondPayments = (await orderOf(feeStore, second.clientRequestId)).payments;
    expect(firstPayments.map(({ flutaFeeBps, flutaFeeAmount }) => ({ flutaFeeBps, flutaFeeAmount }))).toEqual(
      expect.arrayContaining([
        { flutaFeeBps: 150, flutaFeeAmount: 2_400 },
        { flutaFeeBps: 0, flutaFeeAmount: 0 },
      ]),
    );
    expect(firstPayments).toHaveLength(2);
    expect(secondPayments).toEqual([expect.objectContaining({ flutaFeeBps: 500, flutaFeeAmount: 8_000 })]);

    // Paystack was sent each payment's own charge.
    const saved = await paymentsByReference(feeStore.id);
    for (const [reference, sent] of fakePaystack.transactions) {
      expect(sent.transactionChargeKobo).toBe(saved.get(reference)?.flutaFeeAmount);
    }
    expect(fakePaystack.transactions.size).toBe(3);
  });
});

describe("Pay now on the tracking page", () => {
  it("offers the full balance due, pre-filled with the customer's email", async () => {
    const result = await book(payLater, booking(payLater));
    const page = await loadTrackingPage(result.token);
    if (page.kind !== "VALID") throw new Error("The link should work");
    expect(page.view.payNow).toEqual({
      amount: "₦1,600",
      email: "amina@example.com",
      warning: "You'll pay on Paystack's secure page. Pay Later Laundry will never ask you to transfer money to a personal account.",
      recentAttempt: false,
    });
  });

  it("is never offered, and refused on the server, at a store that isn't connected", async () => {
    const result = await book(unconnected, booking(unconnected));
    const page = await loadTrackingPage(result.token);
    if (page.kind !== "VALID") throw new Error("The link should work");
    expect(page.view.payNow).toBeNull();

    expect(await startOnlinePayment(result.token, { email: "amina@example.com" })).toEqual({
      ok: false,
      message: "Online payment isn't available for this order. Please pay the store directly.",
    });
    expect(fakePaystack.calls).toEqual([]);
  });

  it("refuses a malformed token, an unknown one, and a missing email without calling Paystack", async () => {
    expect(await startOnlinePayment("not a token", { email: "amina@example.com" })).toMatchObject({ ok: false });
    expect(await startOnlinePayment("A".repeat(43), { email: "amina@example.com" })).toMatchObject({ ok: false });
    const result = await book(payLater, booking(payLater));
    expect(await startOnlinePayment(result.token, { email: " " })).toEqual({
      ok: false,
      message: "Enter your email for your Paystack receipt",
      fieldErrors: { email: "Enter your email for your Paystack receipt" },
    });
    expect(fakePaystack.calls).toEqual([]);
  });

  it("saves the email on a customer who had none, and never overwrites one", async () => {
    const request = booking(payLater, { customer: { name: "Ngozi Eze", phone: newPhone(), email: "" } });
    const result = await book(payLater, request);
    const { customerId } = await orderOf(payLater, request.clientRequestId);

    await startOnlinePayment(result.token, { email: "Ngozi@Example.com" });
    await startOnlinePayment(result.token, { email: "someone.else@example.com" });

    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).email).toBe("ngozi@example.com");
    const { payments } = await orderOf(payLater, request.clientRequestId);
    expect(payments.map((payment) => payment.payerEmail).sort()).toEqual(["ngozi@example.com", "someone.else@example.com"]);
  });

  it("says a payment is being confirmed while a recent attempt is pending, and matches the return to this order", async () => {
    const result = await book(payLater, booking(payLater));
    const other = await book(payLater, booking(payLater));
    await startOnlinePayment(result.token, { email: "amina@example.com" });
    await startOnlinePayment(other.token, { email: "amina@example.com" });

    const page = await loadTrackingPage(result.token, new Date());
    if (page.kind !== "VALID") throw new Error("The link should work");
    expect(page.view.payNow?.recentAttempt).toBe(true);

    const referenceOf = async (token: string) =>
      (await prisma.payment.findFirstOrThrow({ where: { storeId: payLater.id, orderId: await orderIdOf(token) } })).paystackReference ?? "";
    const own = await referenceOf(result.token);

    expect(await isPaymentBeingConfirmed(result.token, own)).toBe(true);
    // Another order's reference, or one that doesn't exist, shows nothing.
    expect(await isPaymentBeingConfirmed(other.token, own)).toBe(false);
    expect(await isPaymentBeingConfirmed(result.token, await referenceOf(other.token))).toBe(false);
    expect(await isPaymentBeingConfirmed(result.token, "FL-00000000000000000000")).toBe(false);
  });
});

async function orderIdOf(token: string): Promise<string> {
  return (await prisma.order.findUniqueOrThrow({ where: { trackingTokenHash: hashToken(token) }, select: { id: true } })).id;
}
