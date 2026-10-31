import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { FulfilmentType, OrderStage, PickupWindowStatus, PrismaClient } from "@/generated/prisma/client";
import { addDaysToDateKey, fromDateKey, getLocalDateKey } from "@/lib/time";
import { requireStoreMember } from "@/server/auth/session";
import { getPrisma } from "@/server/data/client";
import { findComingUp } from "@/server/data/deliveries";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";
import { getComingUpRange } from "@/server/domain/deliveries";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { getComingUp, getDeliveries } from "./deliveries";

// "Coming up" on the Deliveries view. Each test gets its own throwaway store,
// so its counts are exact; the seeded stores (with work in every stage) never
// change, and must never show up in another store's numbers.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

vi.setConfig({ testTimeout: 90_000 });

const EMAIL_DOMAIN = "coming-up-test.example";
const PASSWORD = "test-password-1234";
const TIME_ZONE = "Africa/Lagos";
const CUSTOMER = { name: "Coming Up Customer", phone: "+2348030000077" };
const ADDRESS = "7 Hidden Close, Wuse";
const AREA = "Coming Up Test Area";

interface TestStore {
  id: string;
  orderPrefix: string;
  timeZone: string;
  customerId: string;
  nextOrderNumber: number;
}

let prisma: PrismaClient;
let today: string;
const storeIds: string[] = [];

beforeAll(() => {
  prisma = createTestPrisma();
  today = getLocalDateKey(new Date(), TIME_ZONE);
});

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, customers, or users.
  const where = { storeId: { in: storeIds } };
  await prisma.$transaction(
    [
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
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function makeStore(): Promise<TestStore> {
  const suffix = randomUUID().slice(0, 8);
  const created = await prisma.store.create({
    data: {
      name: "Coming Up Test Laundry",
      slug: `coming-up-test-${suffix}`,
      orderPrefix: "CU",
      timeZone: TIME_ZONE,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: CUSTOMER },
    },
    select: { id: true, orderPrefix: true, timeZone: true, customers: { select: { id: true } } },
  });
  storeIds.push(created.id);
  return { id: created.id, orderPrefix: created.orderPrefix, timeZone: created.timeZone, customerId: created.customers[0].id, nextOrderNumber: 1 };
}

interface OrderSpec {
  stage: OrderStage;
  fulfilmentType?: FulfilmentType;
  status?: PickupWindowStatus;
  // Days from today (store time zone). For a requested time it's the
  // requested date; otherwise the scheduled (suggested or confirmed) one.
  inDays?: number;
  window?: [string, string];
  area?: string | null;
  stageBeforeQuote?: OrderStage;
}

// An order as earlier steps would have left it, with a price and notes the
// section must never show.
async function makeOrder(store: TestStore, spec: OrderSpec): Promise<string> {
  const fulfilmentType = spec.fulfilmentType ?? "PICKUP_DELIVERY";
  const pickup = fulfilmentType === "PICKUP_DELIVERY";
  const status = pickup ? (spec.status ?? "CONFIRMED") : null;
  const date = fromDateKey(addDaysToDateKey(today, spec.inDays ?? 1));
  const [start, end] = spec.window ?? ["10:00", "12:00"];
  const requested = pickup ? { requestedPickupDate: date, requestedWindowStart: start, requestedWindowEnd: end } : {};
  const scheduled =
    pickup && status !== "REQUESTED" ? { scheduledPickupDate: date, scheduledWindowStart: start, scheduledWindowEnd: end } : {};

  const order = await prisma.order.create({
    data: {
      storeId: store.id,
      orderNumber: store.nextOrderNumber++,
      customerId: store.customerId,
      channel: "PHONE",
      fulfilmentType,
      stage: spec.stage,
      stageBeforeQuote: spec.stageBeforeQuote ?? null,
      serviceAreaName: pickup ? (spec.area === undefined ? AREA : spec.area) : null,
      addressText: pickup ? ADDRESS : null,
      pickupWindowStatus: status,
      ...requested,
      ...scheduled,
      fulfilmentCharge: pickup ? 123_400 : null,
      internalNote: "Gate code 4512",
      customerNote: "Please call on arrival",
      trackingTokenHash: randomUUID(),
      trackingTokenIssuedAt: new Date(),
    },
    select: { id: true },
  });
  return order.id;
}

async function comingUpFor(store: TestStore) {
  return getComingUp(store, new Date());
}

describe("the Coming up data", () => {
  it("returns exactly the listed fields: never IDs, names, phones, addresses, order numbers, or money", async () => {
    const store = await makeStore();
    await makeOrder(store, { stage: "PICKUP_SCHEDULED" });
    await makeOrder(store, { stage: "BOOKED", status: "REQUESTED", inDays: 2 });
    await makeOrder(store, { stage: "IN_PROGRESS" });

    const { firstDayKey, lastDayKey } = getComingUpRange(today);
    const record = await findComingUp(store.id, firstDayKey, lastDayKey);
    expect(Object.keys(record).sort()).toEqual(["cleaningCount", "pickups", "waitingCount"]);
    expect(record.pickups).toHaveLength(1);
    expect(Object.keys(record.pickups[0]).sort()).toEqual([
      "scheduledPickupDate",
      "scheduledWindowEnd",
      "scheduledWindowStart",
      "serviceAreaName",
    ]);
    expect(record).toMatchObject({ waitingCount: 1, cleaningCount: 1 });

    const comingUp = await comingUpFor(store);
    expect(Object.keys(comingUp).sort()).toEqual(["cleaning", "days", "empty", "waiting"]);
    expect(Object.keys(comingUp.days[0]).sort()).toEqual(["date", "heading", "pickups"]);

    const ids = (await prisma.order.findMany({ where: { storeId: store.id }, select: { id: true } })).map((order) => order.id);
    for (const text of [JSON.stringify(record), JSON.stringify(comingUp)]) {
      for (const secret of [...ids, store.id, store.customerId, CUSTOMER.name, CUSTOMER.phone, ADDRESS, "CU-", "123400", "Gate code", "call on arrival"]) {
        expect(text).not.toContain(secret);
      }
    }
  });
});

describe("what Coming up shows", () => {
  it("lists confirmed pickups for tomorrow through day 7 by day, and counts waiting and being-cleaned orders", async () => {
    const store = await makeStore();
    await makeOrder(store, { stage: "PICKUP_SCHEDULED", inDays: 1, window: ["14:00", "16:00"], area: "Garki" });
    await makeOrder(store, { stage: "PICKUP_SCHEDULED", inDays: 1, window: ["08:00", "10:00"], area: "Wuse" });
    await makeOrder(store, { stage: "PICKUP_SCHEDULED", inDays: 7, area: null });
    // Waiting: requested, or suggested by the store, within the 7 days.
    await makeOrder(store, { stage: "BOOKED", status: "REQUESTED", inDays: 3 });
    await makeOrder(store, { stage: "BOOKED", status: "PROPOSED_BY_STORE", inDays: 7 });
    // Not waiting: outside the 7 days.
    await makeOrder(store, { stage: "BOOKED", status: "REQUESTED", inDays: 0 });
    await makeOrder(store, { stage: "BOOKED", status: "PROPOSED_BY_STORE", inDays: 8 });
    // Being cleaned.
    for (const stage of ["PICKED_UP", "RECEIVED_BY_STORE", "IN_PROGRESS"] as const) await makeOrder(store, { stage });
    await makeOrder(store, { stage: "QUOTE_AWAITING_APPROVAL", stageBeforeQuote: "RECEIVED_BY_STORE" });
    // Not being cleaned: the pickup charge sent before pickup, and Ready or later.
    await makeOrder(store, { stage: "QUOTE_AWAITING_APPROVAL", stageBeforeQuote: "BOOKED" });
    for (const stage of ["READY", "OUT_FOR_DELIVERY", "COMPLETED"] as const) await makeOrder(store, { stage });

    const comingUp = await comingUpFor(store);
    const tomorrow = addDaysToDateKey(today, 1);
    const lastDay = addDaysToDateKey(today, 7);
    expect(comingUp.days.map(({ date, pickups }) => ({ date, pickups }))).toEqual([
      { date: tomorrow, pickups: ["8:00 AM – 10:00 AM · Wuse", "2:00 PM – 4:00 PM · Garki"] },
      { date: lastDay, pickups: ["10:00 AM – 12:00 PM · Outside our service areas"] },
    ]);
    expect(comingUp.days[0].heading).toMatch(/^Tomorrow, \w{3} \d{1,2} \w{3} · 2 pickups$/);
    expect(comingUp.days[1].heading).toMatch(/^\w{3} \d{1,2} \w{3} · 1 pickup$/);
    expect(comingUp.waiting).toBe("2 more pickups are waiting for the store to confirm a time.");
    expect(comingUp.cleaning).toBe("4 orders are being cleaned and will need delivery.");
    expect(comingUp.empty).toBe(false);
  });

  it("drops a pickup once it moves past Pickup scheduled, and never counts a Booked order with a confirmed time as waiting", async () => {
    const store = await makeStore();
    const orderId = await makeOrder(store, { stage: "PICKUP_SCHEDULED" });
    await makeOrder(store, { stage: "BOOKED", status: "CONFIRMED" });
    const before = await comingUpFor(store);
    expect(before.days.flatMap((day) => day.pickups)).toHaveLength(1);
    expect(before.waiting).toBeNull();

    await prisma.order.update({ where: { id: orderId }, data: { stage: "PICKED_UP" } });
    expect(await comingUpFor(store)).toEqual({
      days: [],
      waiting: null,
      cleaning: "1 order is being cleaned and will need delivery.",
      empty: false,
    });
  });

  it("never shows drop-off or cancelled orders, and leaves today's pickups in the Pickups section", async () => {
    const store = await makeStore();
    for (const stage of ["RECEIVED_BY_STORE", "IN_PROGRESS"] as const) await makeOrder(store, { stage, fulfilmentType: "DROP_OFF" });
    await makeOrder(store, { stage: "CANCELLED", inDays: 1 });
    await makeOrder(store, { stage: "CANCELLED", status: "REQUESTED", inDays: 2 });
    const todayId = await makeOrder(store, { stage: "PICKUP_SCHEDULED", inDays: 0 });
    await makeOrder(store, { stage: "PICKUP_SCHEDULED", inDays: 8 });

    expect(await comingUpFor(store)).toEqual({ days: [], waiting: null, cleaning: null, empty: true });
    expect((await getDeliveries(store, new Date())).pickups.map((card) => card.orderId)).toEqual([todayId]);
  });
});

describe("store isolation", () => {
  it("a rider sees only their own store's upcoming work, with the store taken from the membership", async () => {
    const own = await makeStore();
    const other = await makeStore();
    await makeOrder(own, { stage: "PICKUP_SCHEDULED", area: "Own Store Area" });
    await makeOrder(other, { stage: "PICKUP_SCHEDULED", area: AREA });
    await makeOrder(other, { stage: "BOOKED", status: "REQUESTED" });
    await makeOrder(other, { stage: "IN_PROGRESS" });

    const email = `rider-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
    const { id } = await createUserWithPassword({ name: "Coming Up Rider", email, password: PASSWORD }, prisma);
    const membership = await createMembership(own.id, { userId: id, role: "RIDER" }, prisma);
    if (!membership.success) throw new Error("Couldn't add the rider to the test store");
    request.headers = await signInHeaders(email, PASSWORD);

    const member = await requireStoreMember({ allowRider: true });
    if (!member.allowed) throw new Error("The rider should be allowed on the Deliveries view");
    expect(member.store.id).toBe(own.id);
    // Exact, though the other store and the seeded stores have work in every stage.
    const comingUp = await getComingUp(member.store, new Date());
    expect(comingUp.days.flatMap((day) => day.pickups)).toEqual(["10:00 AM – 12:00 PM · Own Store Area"]);
    expect(comingUp).toMatchObject({ waiting: null, cleaning: null });
  });

  it("a FreshFold rider never sees another store's upcoming work", async () => {
    const other = await makeStore();
    await makeOrder(other, { stage: "PICKUP_SCHEDULED", area: "Isolation Check Area" });

    request.headers = await signInHeaders("tayo@freshfold.example");
    const member = await requireStoreMember({ allowRider: true });
    if (!member.allowed) throw new Error("Tayo should be allowed on the Deliveries view");
    const freshFold = await prisma.store.findUniqueOrThrow({ where: { slug: "freshfold-laundry" }, select: { id: true } });
    expect(member.store.id).toBe(freshFold.id);
    expect(JSON.stringify(await getComingUp(member.store, new Date()))).not.toContain("Isolation Check Area");
  });
});
