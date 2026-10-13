import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { FulfilmentType, OrderStage, PaymentStatus, PrismaClient, QuoteStatus } from "@/generated/prisma/client";
import { getQuoteRevisionLabel, PAYMENT_STATES } from "@/lib/orders";
import { DEFAULT_ORDER_LIST_FILTERS, encodeOrderListCursor, type OrderListFilters } from "@/schemas/orders";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { listOrders } from "@/server/data/orders";
import { createUserWithPassword } from "@/server/data/users";
import { getBalance } from "@/server/domain/balance";
import { buildOrderListQuery } from "@/server/domain/order-list";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { countQueries } from "@/test/integration/query-count";

import { getOpenOrderCount, getOrderDetail, getOrderListPage, isStoreOrder, type OrderListStore } from "./orders";

// Pages and actions read the session from next/headers; here it's the
// headers of whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.setConfig({ testTimeout: 60_000 });

// A throwaway store with orders built for each check, so the seeded stores
// stay untouched. "Now" is fixed: 12 October 2026, 11:00 in Lagos.
const NOW = new Date("2026-10-12T10:00:00Z");
const EMAIL_DOMAIN = "order-list-test.example";

let prisma: PrismaClient;
let store: OrderListStore;
let staffIds: [string, string];
// Order IDs by name (see buildFixtures).
const orders: Record<string, string> = {};
let numberById: Map<string, number>;
let seeded: { freshFold: OrderListStore; cleanWave: OrderListStore; cleanWaveOrderId: string };

interface FixtureOrder {
  name: string;
  orderNumber: number;
  customer: "adaeze" | "bola" | "chidi" | "filler";
  fulfilmentType?: FulfilmentType;
  stage: OrderStage;
  createdAt: string;
  // Revisions, oldest first; the APPROVED one becomes the approved quote.
  revisions: { total: number; status: QuoteStatus; approved?: boolean }[];
  payments?: { amount: number; status: PaymentStatus; voided?: boolean }[];
  refunds?: { amount: number; voided?: boolean }[];
  events?: number;
  unweighed?: boolean;
}

const CUSTOMERS = {
  adaeze: { name: "Adaeze Nwankwo", phone: "+2348031234567" },
  bola: { name: "Bola Ahmed", phone: "+2348059876543" },
  chidi: { name: "Chidi Okafor", phone: "+2347012345678" },
  filler: { name: "Filler Customer", phone: "+2348090000000" },
} as const;

const approved = (total: number) => ({ total, status: "APPROVED" as const, approved: true });

// A to G cover each payment state and the edges of each date range (in Lagos,
// UTC+1). H has a long history. The 25 filler orders make the list page.
const FIXTURES: FixtureOrder[] = [
  // Today, 9:00 AM. Paid.
  { name: "A", orderNumber: 5001, customer: "adaeze", stage: "IN_PROGRESS", createdAt: "2026-10-12T08:00:00Z",
    revisions: [approved(620_000)], payments: [{ amount: 620_000, status: "CONFIRMED" }] },
  // Today, 12:00 AM exactly. Outstanding.
  { name: "B", orderNumber: 5002, customer: "bola", fulfilmentType: "PICKUP_DELIVERY", stage: "PICKUP_SCHEDULED",
    createdAt: "2026-10-11T23:00:00Z", revisions: [approved(500_000)] },
  // Yesterday, 11:59 PM. Unweighed per-kg line, version 1 never sent: Awaiting quote.
  { name: "C", orderNumber: 5003, customer: "chidi", stage: "RECEIVED_BY_STORE", createdAt: "2026-10-11T22:59:00Z",
    revisions: [{ total: 450_000, status: "PENDING" }], unweighed: true },
  // First minute of the 7-day range. Cancelled after paying: Refund owed.
  { name: "D", orderNumber: 5004, customer: "adaeze", stage: "CANCELLED", createdAt: "2026-10-05T23:00:00Z",
    revisions: [approved(300_000)], payments: [{ amount: 300_000, status: "CONFIRMED" }] },
  // Just before the 7-day range. Overpaid, refunded: Paid. Pending, voided, and voided refunds don't count.
  { name: "E", orderNumber: 5005, customer: "bola", stage: "COMPLETED", createdAt: "2026-10-05T22:59:00Z",
    revisions: [approved(200_000)],
    payments: [
      { amount: 250_000, status: "CONFIRMED" },
      { amount: 100_000, status: "PENDING" },
      { amount: 50_000, status: "VOIDED", voided: true },
    ],
    refunds: [{ amount: 50_000 }, { amount: 20_000, voided: true }] },
  // First minute of the 30-day range. Part paid (a failed attempt doesn't count): Outstanding.
  { name: "F", orderNumber: 5006, customer: "chidi", fulfilmentType: "PICKUP_DELIVERY", stage: "READY",
    createdAt: "2026-09-12T23:00:00Z", revisions: [approved(400_000)],
    payments: [{ amount: 100_000, status: "CONFIRMED" }, { amount: 400_000, status: "FAILED" }] },
  // Just before the 30-day range. A ₦0 order: Paid.
  { name: "G", orderNumber: 5007, customer: "adaeze", stage: "BOOKED", createdAt: "2026-09-12T22:59:00Z",
    revisions: [approved(0)] },
  // A long history: many events, revisions, payments, and refunds. Refund owed.
  { name: "H", orderNumber: 5008, customer: "adaeze", stage: "IN_PROGRESS", createdAt: "2026-07-01T09:00:00Z",
    revisions: [
      { total: 900_000, status: "SUPERSEDED" },
      { total: 950_000, status: "SUPERSEDED" },
      { total: 980_000, status: "SUPERSEDED" },
      { total: 990_000, status: "SUPERSEDED" },
      approved(1_000_000),
    ],
    payments: Array.from({ length: 6 }, () => ({ amount: 200_000, status: "CONFIRMED" as const })),
    refunds: [{ amount: 50_000 }, { amount: 50_000 }, { amount: 50_000 }],
    events: 12 },
  // Cancelled before anything was paid: Nothing due, never Paid.
  { name: "I", orderNumber: 5009, customer: "filler", stage: "CANCELLED", createdAt: "2026-06-01T09:00:00Z",
    revisions: [approved(350_000)] },
  // Cancelled while still awaiting its quote (never priced): Nothing due, not Awaiting quote.
  { name: "J", orderNumber: 5010, customer: "filler", stage: "CANCELLED", createdAt: "2026-06-02T09:00:00Z",
    revisions: [{ total: 450_000, status: "PENDING" }], unweighed: true },
  ...Array.from({ length: 25 }, (_, index): FixtureOrder => ({
    name: `filler-${index}`,
    orderNumber: 5101 + index,
    customer: "filler",
    stage: "IN_PROGRESS",
    createdAt: new Date(Date.UTC(2026, 7, 1, 9, index)).toISOString(),
    revisions: [approved(100_000)],
  })),
];

beforeAll(async () => {
  prisma = createTestPrisma();
  const suffix = randomUUID().slice(0, 8);
  const created = await prisma.store.create({
    data: {
      name: "Order List Test Laundry",
      slug: `order-list-test-${suffix}`,
      orderPrefix: "OL",
      timeZone: "Africa/Lagos",
      subscription: { create: { planName: "Test", priceAmount: 0 } },
    },
    select: { id: true, orderPrefix: true, timeZone: true },
  });
  store = created;
  staffIds = [await addStaff("first"), await addStaff("second")];
  await buildFixtures();

  const [ff, cw] = await Promise.all(
    ["freshfold-laundry", "cleanwave-laundry"].map((slug) =>
      prisma.store.findUniqueOrThrow({
        where: { slug },
        select: { id: true, orderPrefix: true, timeZone: true, orders: { take: 1, select: { id: true } } },
      }),
    ),
  );
  seeded = {
    freshFold: { id: ff.id, orderPrefix: ff.orderPrefix, timeZone: ff.timeZone },
    cleanWave: { id: cw.id, orderPrefix: cw.orderPrefix, timeZone: cw.timeZone },
    cleanWaveOrderId: cw.orders[0].id,
  };
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, customers, or users.
  const where = { storeId: store.id };
  await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
  await prisma.$transaction(
    [
      prisma.statusEvent.deleteMany({ where }),
      prisma.payment.deleteMany({ where }),
      prisma.refund.deleteMany({ where }),
      prisma.quoteRevision.deleteMany({ where }),
      prisma.orderLine.deleteMany({ where }),
      prisma.order.deleteMany({ where }),
      prisma.customer.deleteMany({ where }),
      prisma.service.deleteMany({ where }),
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
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function addStaff(label: string): Promise<string> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const { id } = await createUserWithPassword({ name: `Staff ${label}`, email, password: "test-password-1234" }, prisma);
  const result = await createMembership(store.id, { userId: id, role: "STAFF" }, prisma);
  if (!result.success) throw new Error(`Couldn't add ${email} to the test store`);
  return id;
}

// Everything is written in bulk (a handful of round trips, not hundreds).
async function buildFixtures(): Promise<void> {
  const storeId = store.id;
  const service = (name: string, pricingType: "PER_ITEM" | "PER_KG", price: number) =>
    prisma.service.create({
      data: { storeId, name, nameKey: name.toLowerCase(), pricingType, price, requiresQuote: pricingType === "PER_KG" },
      select: { id: true },
    });
  const [shirt, wash] = await Promise.all([service("Shirt", "PER_ITEM", 80_000), service("Wash & fold", "PER_KG", 150_000)]);

  const customerIds = Object.fromEntries(Object.keys(CUSTOMERS).map((key) => [key, `ol-cust-${key}-${randomUUID()}`]));
  await prisma.customer.createMany({
    data: Object.entries(CUSTOMERS).map(([key, customer]) => ({ id: customerIds[key], storeId, ...customer })),
  });

  for (const fixture of FIXTURES) orders[fixture.name] = `ol-order-${fixture.orderNumber}-${randomUUID()}`;
  await prisma.order.createMany({
    data: FIXTURES.map((fixture) => ({
      id: orders[fixture.name],
      storeId,
      orderNumber: fixture.orderNumber,
      customerId: customerIds[fixture.customer],
      channel: "COUNTER",
      fulfilmentType: fixture.fulfilmentType ?? "DROP_OFF",
      stage: fixture.stage,
      trackingTokenHash: randomUUID(),
      trackingTokenIssuedAt: new Date(fixture.createdAt),
      createdByUserId: staffIds[0],
      createdAt: new Date(fixture.createdAt),
      cancelledAt: fixture.stage === "CANCELLED" ? new Date(fixture.createdAt) : null,
      ...(fixture.fulfilmentType === "PICKUP_DELIVERY" && {
        serviceAreaName: "Wuse 2",
        addressText: "12 Test Street",
        fulfilmentCharge: 150_000,
        requestedPickupDate: new Date("2026-10-14T00:00:00Z"),
        requestedWindowStart: "10:00",
        requestedWindowEnd: "12:00",
        pickupWindowStatus: "REQUESTED" as const,
      }),
    })),
  });
  numberById = new Map(FIXTURES.map((fixture) => [orders[fixture.name], fixture.orderNumber]));

  await prisma.orderLine.createMany({
    data: FIXTURES.map((fixture) => ({
      storeId,
      orderId: orders[fixture.name],
      lineType: "SERVICE" as const,
      serviceId: fixture.unweighed ? wash.id : shirt.id,
      description: fixture.unweighed ? "Wash & fold" : "Shirt",
      ...(fixture.unweighed
        ? { pricingType: "PER_KG" as const, requiresQuote: true, unitPrice: 150_000, estimatedQuantity: "3.00" }
        : { pricingType: "PER_ITEM" as const, unitPrice: 80_000, quantity: "2", lineTotal: 160_000 }),
    })),
  });

  await prisma.quoteRevision.createMany({
    data: FIXTURES.flatMap((fixture) =>
      fixture.revisions.map((revision, index) => ({
        storeId,
        orderId: orders[fixture.name],
        version: index + 1,
        linesSnapshot: [],
        itemsSubtotal: revision.total,
        total: revision.total,
        status: revision.status,
        createdByActor: "STAFF" as const,
        createdByUserId: staffIds[0],
        createdAt: new Date(fixture.createdAt),
        approvedAt: revision.approved ? new Date(fixture.createdAt) : null,
        approvedByActor: revision.approved ? ("STAFF" as const) : null,
      })),
    ),
  });
  await prisma.$executeRaw`
    UPDATE "Order" o SET "approvedQuoteId" = q."id"
    FROM "QuoteRevision" q
    WHERE q."storeId" = o."storeId" AND q."orderId" = o."id" AND q."status" = 'APPROVED' AND o."storeId" = ${storeId}`;

  await prisma.payment.createMany({
    data: FIXTURES.flatMap((fixture) =>
      (fixture.payments ?? []).map((payment) => ({
        storeId,
        orderId: orders[fixture.name],
        amount: payment.amount,
        source: "STORE_COLLECTED" as const,
        method: "CASH" as const,
        status: payment.status,
        recordedByUserId: staffIds[0],
        confirmedAt: payment.status === "CONFIRMED" || payment.voided ? new Date(fixture.createdAt) : null,
        voidedAt: payment.voided ? new Date(fixture.createdAt) : null,
        voidedByUserId: payment.voided ? staffIds[0] : null,
        voidReason: payment.voided ? "Recorded twice" : null,
      })),
    ),
  });
  await prisma.refund.createMany({
    data: FIXTURES.flatMap((fixture) =>
      (fixture.refunds ?? []).map((refund) => ({
        storeId,
        orderId: orders[fixture.name],
        amount: refund.amount,
        note: "Refunded by transfer",
        recordedByUserId: staffIds[0],
        paidAt: new Date(fixture.createdAt),
        voidedAt: refund.voided ? new Date(fixture.createdAt) : null,
        voidedByUserId: refund.voided ? staffIds[0] : null,
        voidReason: refund.voided ? "Entered in error" : null,
      })),
    ),
  });

  // Events alternate between the two staff members.
  await prisma.statusEvent.createMany({
    data: FIXTURES.flatMap((fixture) =>
      Array.from({ length: fixture.events ?? 1 }, (_, index) => ({
        storeId,
        orderId: orders[fixture.name],
        fromStage: index === 0 ? null : fixture.stage,
        toStage: fixture.stage,
        actorType: "STAFF" as const,
        actorUserId: staffIds[index % 2],
        createdAt: new Date(new Date(fixture.createdAt).getTime() + index * 60_000),
      })),
    ),
  });
}

// Every matching order number in the test store (no paging).
async function find(filters: Partial<OrderListFilters>, inStore: OrderListStore = store): Promise<number[]> {
  const query = buildOrderListQuery({ ...DEFAULT_ORDER_LIST_FILTERS, ...filters }, inStore, NOW);
  const { orders: found } = await listOrders(inStore.id, query, 500);
  return found.map((order) => order.orderNumber).sort((a, b) => a - b);
}

const FILLER = Array.from({ length: 25 }, (_, index) => 5101 + index);

describe("store isolation", () => {
  it("never lists another store's orders", async () => {
    const cleanWaveIds = new Set(
      (await prisma.order.findMany({ where: { storeId: seeded.cleanWave.id }, select: { id: true } })).map((o) => o.id),
    );
    const query = buildOrderListQuery(DEFAULT_ORDER_LIST_FILTERS, seeded.freshFold, NOW);
    const { orders: listed } = await listOrders(seeded.freshFold.id, query, 500);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.some((order) => cleanWaveIds.has(order.id))).toBe(false);
  });

  it("finds nothing for another store's order ID", async () => {
    expect(await isStoreOrder(seeded.freshFold.id, seeded.cleanWaveOrderId)).toBe(false);
    expect(await getOrderDetail(seeded.freshFold.id, seeded.cleanWaveOrderId, "STAFF")).toBeNull();
    expect(await isStoreOrder(seeded.cleanWave.id, seeded.cleanWaveOrderId)).toBe(true);
  });

  it("shows a FreshFold member Order not found (404), not no access, for a CleanWave order", async () => {
    request.headers = await signInHeaders("kemi@freshfold.example");
    const { default: OrderPage } = await import("@/app/(workspace)/orders/[id]/page");

    const page = (id: string) => OrderPage({ params: Promise.resolve({ id }) } as PageProps<"/orders/[id]">);
    for (const id of [seeded.cleanWaveOrderId, "no-such-order"]) {
      await expect(page(id)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    }
  });

  it("loads more of the member's own store only", async () => {
    request.headers = await signInHeaders("kemi@freshfold.example");
    const { loadMoreOrders } = await import("@/actions/orders");
    const result = await loadMoreOrders(
      DEFAULT_ORDER_LIST_FILTERS,
      encodeOrderListCursor({ createdAt: new Date("2100-01-01T00:00:00Z"), id: "z" }),
    );
    if (!result.ok) expect.unreachable(result.message);
    const freshFoldIds = new Set(
      (await prisma.order.findMany({ where: { storeId: seeded.freshFold.id }, select: { id: true } })).map((o) => o.id),
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((row) => freshFoldIds.has(row.id))).toBe(true);

    // Malformed filters (a tampered request) fall back to the defaults.
    const fallback = await loadMoreOrders(
      "not filters",
      encodeOrderListCursor({ createdAt: new Date("2100-01-01T00:00:00Z"), id: "z" }),
    );
    if (!fallback.ok) expect.unreachable(fallback.message);
    expect(fallback.rows.map((row) => row.id)).toEqual(result.rows.map((row) => row.id));
  });
});

describe("search", () => {
  it.each(["5003", "OL-5003", "ol5003", " ol - 5003 "])("finds an order by its number written %j", async (q) => {
    expect(await find({ q })).toEqual([5003]);
  });

  it("matches no order number when the prefix is another store's", async () => {
    expect(await find({ q: "CW5003" })).toEqual([]);
  });

  it.each(["0803 123", "803123", "+234 803 123", "2348031234567"])("finds Adaeze's orders by phone %j", async (q) => {
    expect(await find({ q })).toEqual([5001, 5004, 5007, 5008]);
  });

  it("finds orders by any part of the name, ignoring capitals", async () => {
    expect(await find({ q: "nwank" })).toEqual([5001, 5004, 5007, 5008]);
    expect(await find({ q: "OKAFOR" })).toEqual([5003, 5006]);
  });

  it.each(["ABC", "12.5", "%", "_"])("treats %j as plain text without failing", async (q) => {
    expect(await find({ q })).toEqual([]);
  });

  it("searches within the store only", async () => {
    // A CleanWave customer's name, phone, or an order number finds only FreshFold orders.
    const cleanWaveCustomer = await prisma.customer.findFirstOrThrow({
      where: { storeId: seeded.cleanWave.id },
      select: { name: true, phone: true },
    });
    const freshFoldIds = new Set(
      (await prisma.order.findMany({ where: { storeId: seeded.freshFold.id }, select: { orderNumber: true } })).map(
        (order) => order.orderNumber,
      ),
    );
    for (const q of [cleanWaveCustomer.name, cleanWaveCustomer.phone.slice(-7), "1001"]) {
      const found = await find({ q }, seeded.freshFold);
      expect(found.every((number) => freshFoldIds.has(number))).toBe(true);
    }
    // And the test store's own customers aren't found from FreshFold.
    expect(await find({ q: "Adaeze Nwankwo" }, seeded.freshFold)).toEqual([]);
  });
});

describe("filters", () => {
  it("filters by stage", async () => {
    expect(await find({ stage: "READY" })).toEqual([5006]);
    expect(await find({ stage: "CANCELLED" })).toEqual([5004, 5009, 5010]);
  });

  it("filters by payment state", async () => {
    expect(await find({ payment: "PAID" })).toEqual([5001, 5005, 5007]);
    expect(await find({ payment: "OUTSTANDING" })).toEqual([5002, 5006, ...FILLER]);
    expect(await find({ payment: "REFUND_OWED" })).toEqual([5004, 5008]);
    expect(await find({ payment: "AWAITING_QUOTE" })).toEqual([5003]);
    expect(await find({ payment: "NOTHING_DUE" })).toEqual([5009, 5010]);
  });

  it("filters by fulfilment type", async () => {
    expect(await find({ type: "PICKUP_DELIVERY" })).toEqual([5002, 5006]);
  });

  it("filters by created date in calendar days in the store's time zone", async () => {
    // 12:00 AM today (23:00 UTC yesterday) is in; 11:59 PM yesterday is out.
    expect(await find({ created: "today" })).toEqual([5001, 5002]);
    // Today plus the previous 6 days start at 12:00 AM on 6 October.
    expect(await find({ created: "7d" })).toEqual([5001, 5002, 5003, 5004]);
    // Today plus the previous 29 days start at 12:00 AM on 13 September.
    expect(await find({ created: "30d" })).toEqual([5001, 5002, 5003, 5004, 5005, 5006]);
    expect(await find({ created: "all" })).toHaveLength(FIXTURES.length);
  });

  it("combines filters and search", async () => {
    expect(await find({ created: "7d", payment: "OUTSTANDING" })).toEqual([5002]);
    expect(await find({ type: "DROP_OFF", payment: "PAID", created: "30d" })).toEqual([5001, 5005]);
    expect(await find({ stage: "CANCELLED", payment: "REFUND_OWED" })).toEqual([5004]);
    expect(await find({ q: "bola", created: "today", type: "PICKUP_DELIVERY", stage: "PICKUP_SCHEDULED" })).toEqual([
      5002,
    ]);
    expect(await find({ q: "adaeze", payment: "OUTSTANDING" })).toEqual([]);
  });
});

describe("payment-state filter", () => {
  // The SQL filter must classify every order exactly as getBalance does.
  it("agrees with getBalance on every order in the test and seeded stores", async () => {
    for (const checked of [store, seeded.freshFold, seeded.cleanWave]) {
      const all = await prisma.order.findMany({
        where: { storeId: checked.id },
        select: {
          id: true,
          stage: true,
          approvedQuote: { select: { total: true } },
          payments: { select: { amount: true, status: true, voidedAt: true } },
          refunds: { select: { amount: true, voidedAt: true } },
        },
      });
      for (const state of PAYMENT_STATES) {
        const expected = all.filter((order) => getBalance(order).state === state).map((order) => order.id);
        const query = buildOrderListQuery({ ...DEFAULT_ORDER_LIST_FILTERS, payment: state }, checked, NOW);
        const { orders: found } = await listOrders(checked.id, query, 1000);
        expect(found.map((order) => order.id).sort(), `${state} at ${checked.orderPrefix}`).toEqual(expected.sort());
      }
    }
  });
});

describe("list rows", () => {
  it("shows the payment badge and total from the approved quote, or Awaiting quote", async () => {
    const { rows } = await getOrderListPage(store, { ...DEFAULT_ORDER_LIST_FILTERS, created: "7d" }, NOW);
    const byNumber = Object.fromEntries(rows.map((row) => [row.displayNumber, row]));
    expect(byNumber["OL-5001"]).toMatchObject({ total: "₦6,200", paymentState: "PAID", customerName: "Adaeze Nwankwo" });
    expect(byNumber["OL-5003"]).toMatchObject({ total: null, paymentState: "AWAITING_QUOTE", services: "Wash & fold" });
    expect(byNumber["OL-5004"]).toMatchObject({ paymentState: "REFUND_OWED", stage: "CANCELLED" });
    expect(byNumber["OL-5002"]).toMatchObject({
      created: "Mon, 12 Oct 2026, 12:00 AM",
      pickup: "Wed, 14 Oct 2026 · 10:00 AM–12:00 PM",
    });
    expect(byNumber["OL-5001"].pickup).toBeNull();
  });
});

describe("open order count", () => {
  it("counts every order not Completed or Cancelled", async () => {
    const expected = await prisma.order.count({
      where: { storeId: store.id, stage: { notIn: ["COMPLETED", "CANCELLED"] } },
    });
    expect(await getOpenOrderCount(store.id)).toBe(expected);
    expect(expected).toBe(FIXTURES.length - 4);
  });
});

describe("query counts", () => {
  it("loads one list page with the same number of queries whatever the number of rows", async () => {
    const one = await countQueries(() => getOrderListPage(store, { ...DEFAULT_ORDER_LIST_FILTERS, q: "5003" }, NOW));
    const full = await countQueries(() => getOrderListPage(store, DEFAULT_ORDER_LIST_FILTERS, NOW));
    expect(one.result.rows).toHaveLength(1);
    expect(full.result.rows).toHaveLength(25);
    expect(one.queries).toBeGreaterThan(0);
    expect(full.queries).toBe(one.queries);
  });

  it("loads a long order's detail with the same number of queries as a simple one", async () => {
    const simple = await countQueries(() => getOrderDetail(store.id, orders.A, "STAFF"));
    const long = await countQueries(() => getOrderDetail(store.id, orders.H, "STAFF"));
    expect(long.result?.order.statusEvents).toHaveLength(12);
    expect(long.result?.order.quoteRevisions).toHaveLength(5);
    expect(long.result?.order.payments).toHaveLength(6);
    expect(long.result?.order.refunds).toHaveLength(3);
    expect(simple.queries).toBeGreaterThan(0);
    expect(long.queries).toBe(simple.queries);
  });
});

describe("order detail", () => {
  it("names the staff in the timeline, fetched together", async () => {
    const detail = await getOrderDetail(store.id, orders.H, "STAFF");
    expect([...(detail?.staffNames.values() ?? [])].sort()).toEqual(["Staff first", "Staff second"]);
  });

  it("works out the balance with getBalance, ignoring pending, failed, and voided records", async () => {
    const detail = await getOrderDetail(store.id, orders.E, "STAFF");
    expect(detail?.balance).toEqual({
      state: "PAID",
      approvedTotalKobo: 200_000,
      confirmedPaymentsKobo: 250_000,
      paidRefundsKobo: 50_000,
      balanceKobo: 0,
    });
  });

  it("shows a cancelled order that was never priced as Nothing due, not Awaiting quote", async () => {
    const detail = await getOrderDetail(store.id, orders.J, "STAFF");
    expect(detail?.order.approvedQuote).toBeNull();
    expect(detail?.balance).toEqual({
      state: "NOTHING_DUE",
      approvedTotalKobo: 0,
      confirmedPaymentsKobo: 0,
      paidRefundsKobo: 0,
      balanceKobo: 0,
    });

    const { rows } = await getOrderListPage(store, { ...DEFAULT_ORDER_LIST_FILTERS, stage: "CANCELLED" }, NOW);
    expect(rows.find((row) => row.id === orders.J)).toMatchObject({ paymentState: "NOTHING_DUE", total: null });
    expect(await find({ payment: "AWAITING_QUOTE" })).not.toContain(5010);
  });

  it("labels an unpriced order's version 1 as an Estimate", async () => {
    const detail = await getOrderDetail(store.id, orders.C, "STAFF");
    expect(detail?.order.approvedQuote).toBeNull();
    expect(detail?.order.quoteRevisions.map(getQuoteRevisionLabel)).toEqual(["Estimate"]);
    expect(detail?.balance).toMatchObject({ state: "AWAITING_QUOTE", approvedTotalKobo: null, balanceKobo: null });
  });
});

// Last: it adds an order.
describe("Load more", () => {
  it("never duplicates or skips rows when an order is created between pages", async () => {
    const before = await prisma.order.findMany({ where: { storeId: store.id }, select: { id: true } });
    const first = await getOrderListPage(store, DEFAULT_ORDER_LIST_FILTERS, NOW);
    expect(first.rows).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();

    // A new order arrives while the user is scrolling.
    const customer = await prisma.customer.findFirstOrThrow({ where: { storeId: store.id }, select: { id: true } });
    await prisma.order.create({
      data: {
        storeId: store.id,
        orderNumber: 5999,
        customerId: customer.id,
        channel: "COUNTER",
        fulfilmentType: "DROP_OFF",
        trackingTokenHash: randomUUID(),
        trackingTokenIssuedAt: NOW,
        createdAt: NOW,
      },
    });

    const { orderListCursorSchema } = await import("@/schemas/orders");
    const second = await getOrderListPage(
      store,
      DEFAULT_ORDER_LIST_FILTERS,
      NOW,
      orderListCursorSchema.parse(first.nextCursor),
    );
    expect(second.nextCursor).toBeNull();

    const seen = [...first.rows, ...second.rows].map((row) => row.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(before.map((order) => order.id).sort());
    // Newest first throughout.
    const numbers = [...first.rows, ...second.rows].map((row) => numberById.get(row.id));
    expect(numbers.slice(0, 2)).toEqual([5001, 5002]);
  });
});
