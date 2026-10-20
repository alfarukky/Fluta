import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { addDaysToDateKey, getLocalDateKey, startOfLocalDay } from "@/lib/time";
import { DEFAULT_PAYMENT_LIST_FILTERS, paymentListCursorSchema, type PaymentListFilters } from "@/schemas/payments";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";
import { createTestPrisma } from "@/test/integration/db";
import { countQueries } from "@/test/integration/query-count";

import { getPaymentListPage, getPaymentsPageData, type PaymentListStore } from "./payments";

// The Payments page, read straight from the service: its own store, with
// payments written at known times, so every count and total is exact.

vi.setConfig({ testTimeout: 90_000 });

const EMAIL_DOMAIN = "payments-page-test.example";
const TIME_ZONE = "Africa/Lagos";

let prisma: PrismaClient;
let store: PaymentListStore;
let orderId: string;
let recorder: { id: string; name: string };
// Noon today in the store's time zone, so "an hour ago" is always today.
let now: Date;
const ids: Record<string, string> = {};

const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

beforeAll(async () => {
  prisma = createTestPrisma();
  const today = getLocalDateKey(new Date(), TIME_ZONE);
  now = new Date(startOfLocalDay(today, TIME_ZONE).getTime() + 12 * 60 * 60_000);
  expect(startOfLocalDay(addDaysToDateKey(today, 1), TIME_ZONE) > now).toBe(true);

  const suffix = randomUUID().slice(0, 8);
  const created = await prisma.store.create({
    data: {
      name: "Payments Page Test Laundry",
      slug: `payments-page-test-${suffix}`,
      orderPrefix: "PP",
      timeZone: TIME_ZONE,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: { name: "Ngozi Payments", phone: "+2348030000003" } },
    },
    select: { id: true, orderPrefix: true, timeZone: true, customers: { select: { id: true } } },
  });
  store = { id: created.id, orderPrefix: created.orderPrefix, timeZone: created.timeZone };

  const email = `staff-${suffix}@${EMAIL_DOMAIN}`;
  const user = await createUserWithPassword({ name: "Bisi Cashier", email, password: "test-password-1234" }, prisma);
  const membership = await createMembership(store.id, { userId: user.id, role: "STAFF" }, prisma);
  if (!membership.success) throw new Error("Couldn't add the test staff member");
  recorder = { id: user.id, name: "Bisi Cashier" };

  const order = await prisma.order.create({
    data: {
      storeId: store.id,
      orderNumber: 1042,
      customerId: created.customers[0].id,
      channel: "COUNTER",
      fulfilmentType: "DROP_OFF",
      stage: "READY",
      trackingTokenHash: randomUUID(),
      trackingTokenIssuedAt: now,
    },
    select: { id: true },
  });
  orderId = order.id;

  const voided = { status: "VOIDED" as const, voidedAt: now, voidedByUserId: recorder.id, voidReason: "Entered twice" };
  ids.cashToday = await addPayment({ amount: 300_000, method: "CASH", confirmedAt: minutesAgo(60) });
  ids.posVoided = await addPayment({ amount: 200_000, method: "POS", confirmedAt: minutesAgo(120), ...voided });
  ids.online = await addPayment({ amount: 500_000, ...online(), confirmedAt: minutesAgo(180) });
  // Received today and voided later: counts ₦0 (only Paystack refunds undo
  // online payments in the app, but the totals must never count a void).
  ids.onlineVoided = await addPayment({ amount: 100_000, ...online(), confirmedAt: minutesAgo(180), ...voided });
  ids.pending = await addPayment({ amount: 900_000, ...online(), status: "PENDING", confirmedAt: null, createdAt: minutesAgo(5) });
  ids.failed = await addPayment({ amount: 800_000, ...online(), status: "FAILED", confirmedAt: null, createdAt: minutesAgo(5) });
  // Created recently but confirmed long ago, and the other way round: lists
  // follow the confirmation time.
  ids.confirmedLongAgo = await addPayment({ amount: 700_000, method: "CASH", confirmedAt: daysAgo(10), createdAt: minutesAgo(1) });
  ids.createdLongAgo = await addPayment({
    amount: 50_000,
    method: "BANK_TRANSFER",
    confirmedAt: minutesAgo(1),
    createdAt: daysAgo(20),
  });
  // 26 more two days ago, for paging the last 7 days.
  await prisma.payment.createMany({
    data: Array.from({ length: 26 }, (_, index) =>
      paymentData({ amount: 1_000, method: "OTHER", confirmedAt: new Date(daysAgo(2).getTime() + index * 60_000) }),
    ),
  });
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes payments, orders, or users.
  const where = { storeId: store.id };
  await prisma.$transaction([
    prisma.payment.deleteMany({ where }),
    prisma.order.deleteMany({ where }),
    prisma.customer.deleteMany({ where }),
    prisma.subscription.deleteMany({ where }),
    prisma.membership.deleteMany({ where }),
  ]);
  const users = await prisma.user.findMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

function online() {
  return { method: "PAYSTACK" as const, source: "ONLINE" as const, recordedByUserId: null };
}

function paymentData(overrides: Partial<Prisma.PaymentCreateManyInput>): Prisma.PaymentCreateManyInput {
  return {
    storeId: store.id,
    orderId,
    amount: 100_000,
    source: "STORE_COLLECTED",
    method: "CASH",
    status: "CONFIRMED",
    recordedByUserId: recorder.id,
    createdAt: overrides.confirmedAt ?? now,
    ...overrides,
  };
}

async function addPayment(overrides: Partial<Prisma.PaymentCreateManyInput>): Promise<string> {
  const { id } = await prisma.payment.create({ data: paymentData(overrides), select: { id: true } });
  return id;
}

const filters = (overrides: Partial<PaymentListFilters> = {}): PaymentListFilters => ({
  ...DEFAULT_PAYMENT_LIST_FILTERS,
  ...overrides,
});

describe("Payments page list", () => {
  it("lists confirmed and voided payments received today, newest confirmation first, never pending or failed", async () => {
    const { page } = await getPaymentsPageData(store, "STAFF", filters(), now);
    expect(page.rows.map((row) => row.id)).toEqual([
      ids.createdLongAgo,
      ids.cashToday,
      ids.posVoided,
      // Same confirmation time: by ID, newest first.
      ...[ids.online, ids.onlineVoided].sort().reverse(),
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("shows each row ready to read: order, customer, amount, method, source, who, and status", async () => {
    const { page } = await getPaymentsPageData(store, "STAFF", filters(), now);
    const byId = new Map(page.rows.map((row) => [row.id, row]));
    expect(byId.get(ids.cashToday)).toEqual({
      id: ids.cashToday,
      orderId,
      displayNumber: "PP-1042",
      customerName: "Ngozi Payments",
      confirmed: expect.stringMatching(/, 11:00 AM$/),
      amount: "₦3,000",
      method: "CASH",
      source: "STORE_COLLECTED",
      recordedBy: recorder.name,
      voided: false,
    });
    expect(byId.get(ids.posVoided)).toMatchObject({ voided: true, amount: "₦2,000" });
    expect(byId.get(ids.online)).toMatchObject({ source: "ONLINE", recordedBy: "Online payment" });
  });

  it("filters by method, source, and the day the payment was confirmed", async () => {
    const cash = await getPaymentListPage(store, filters({ method: "CASH" }), now);
    expect(cash.rows.map((row) => row.id)).toEqual([ids.cashToday]);

    const onlineRows = await getPaymentListPage(store, filters({ source: "ONLINE" }), now);
    expect(onlineRows.rows.map((row) => row.id).sort()).toEqual([ids.online, ids.onlineVoided].sort());

    const month = await getPaymentListPage(store, filters({ date: "30d", method: "CASH" }), now);
    expect(month.rows.map((row) => row.id)).toEqual([ids.cashToday, ids.confirmedLongAgo]);

    const week = await getPaymentListPage(store, filters({ date: "7d", method: "CASH" }), now);
    expect(week.rows.map((row) => row.id)).toEqual([ids.cashToday]);
  });

  it("loads 25 at a time with a cursor, without repeats", async () => {
    const first = await getPaymentListPage(store, filters({ date: "7d" }), now);
    expect(first.rows).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();

    const cursor = paymentListCursorSchema.parse(first.nextCursor);
    const second = await getPaymentListPage(store, filters({ date: "7d" }), now, cursor);
    expect(second.nextCursor).toBeNull();

    const all = [...first.rows, ...second.rows].map((row) => row.id);
    // 5 today (pending and failed never), 26 two days ago.
    expect(all).toHaveLength(31);
    expect(new Set(all).size).toBe(31);
  });

  it("uses a fixed number of queries per page, whatever its size", async () => {
    const one = await countQueries(() => getPaymentListPage(store, filters({ method: "BANK_TRANSFER" }), now));
    const full = await countQueries(() => getPaymentListPage(store, filters({ date: "30d" }), now));
    expect(one.result.rows).toHaveLength(1);
    expect(full.result.rows).toHaveLength(25);
    expect(full.queries).toBe(one.queries);
    // The payments, their orders, the customers (one query per relation), and the staff names.
    expect(full.queries).toBe(4);
  });
});

describe("Payments page totals", () => {
  it("shows staff no totals", async () => {
    const { totals } = await getPaymentsPageData(store, "STAFF", filters({ date: "30d" }), now);
    expect(totals).toBeNull();
  });

  it("gives owners confirmed payments only, split store and online: a void counts ₦0", async () => {
    const today = await getPaymentsPageData(store, "OWNER", filters(), now);
    // Cash ₦3,000 + transfer ₦500; the voided POS and online payments count nothing.
    expect(today.totals).toEqual({ storeCollectedKobo: 350_000, onlineKobo: 500_000 });

    const month = await getPaymentsPageData(store, "OWNER", filters({ date: "30d" }), now);
    expect(month.totals).toEqual({ storeCollectedKobo: 350_000 + 700_000 + 26 * 1_000, onlineKobo: 500_000 });
  });

  it("counts the period, not the method or source filters", async () => {
    const { totals } = await getPaymentsPageData(store, "OWNER", filters({ method: "CASH", source: "ONLINE" }), now);
    expect(totals).toEqual({ storeCollectedKobo: 350_000, onlineKobo: 500_000 });
  });
});
