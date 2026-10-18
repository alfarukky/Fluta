import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { FulfilmentType, OrderStage, PrismaClient, StoreRole } from "@/generated/prisma/client";
import { addDaysToDateKey, fromDateKey, getLocalDateKey } from "@/lib/time";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";
import { getDeliveries } from "@/server/services/deliveries";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { markDelivered, markPickedUp, sendOutForDelivery } from "./deliveries";
import { changeOrderStage } from "./order-stages";

// The actions read the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.setConfig({ testTimeout: 90_000 });

// Orders live in a throwaway store with its own owner, staff, and rider, so
// the seeded stores never change.
const EMAIL_DOMAIN = "deliveries-test.example";
const PASSWORD = "test-password-1234";
const TIME_ZONE = "Africa/Lagos";
const CHANGED_MESSAGE = "This order was just updated. Refresh to see the latest.";
const NOT_FOUND = { ok: false, code: "NOT_FOUND", message: "Order not found." };

// Everything a card may carry; anything else would be a leak.
const CARD_FIELDS = ["address", "areaName", "customerName", "customerPhone", "isOutOfArea", "location", "orderId", "orderNumber", "stage"];
const PICKUP_CARD_FIELDS = [...CARD_FIELDS, "isOutsideSchedule", "isOverdue", "scheduledDate", "windowEnd", "windowStart"];

const PICKUP_PATH: OrderStage[] = [
  "BOOKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "RECEIVED_BY_STORE",
  "IN_PROGRESS",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
];
const upTo = (stage: OrderStage) => PICKUP_PATH.slice(0, PICKUP_PATH.indexOf(stage) + 1);

const MOVES = [
  { action: markPickedUp, from: "PICKUP_SCHEDULED", to: "PICKED_UP" },
  { action: sendOutForDelivery, from: "READY", to: "OUT_FOR_DELIVERY" },
  { action: markDelivered, from: "OUT_FOR_DELIVERY", to: "COMPLETED" },
] as const;

let prisma: PrismaClient;
let store: { id: string; orderPrefix: string; timeZone: string };
let customerId: string;
let users: Record<"owner" | "staff" | "rider", { id: string; headers: Headers }>;
let freshFoldRider: Headers;
let today: string;
let nextOrderNumber = 1;

beforeAll(async () => {
  prisma = createTestPrisma();
  const suffix = randomUUID().slice(0, 8);
  const created = await prisma.store.create({
    data: {
      name: "Deliveries Test Laundry",
      slug: `deliveries-test-${suffix}`,
      orderPrefix: "DT",
      timeZone: TIME_ZONE,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: { name: "Delivery Test Customer", phone: "+2348030000002" } },
    },
    select: { id: true, orderPrefix: true, timeZone: true, customers: { select: { id: true } } },
  });
  store = { id: created.id, orderPrefix: created.orderPrefix, timeZone: created.timeZone };
  customerId = created.customers[0].id;
  users = {
    owner: await addUser("owner", "OWNER"),
    staff: await addUser("staff", "STAFF"),
    rider: await addUser("rider", "RIDER"),
  };
  freshFoldRider = await signInHeaders("tayo@freshfold.example");
  today = getLocalDateKey(new Date(), TIME_ZONE);
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, customers, or users.
  const where = { storeId: store.id };
  await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
  await prisma.$transaction(
    [
      prisma.auditEvent.deleteMany({ where }),
      prisma.messageEvent.deleteMany({ where }),
      prisma.statusEvent.deleteMany({ where }),
      prisma.quoteRevision.deleteMany({ where }),
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
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function addUser(label: string, role: StoreRole): Promise<{ id: string; headers: Headers }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const { id } = await createUserWithPassword({ name: `Test ${label}`, email, password: PASSWORD }, prisma);
  const result = await createMembership(store.id, { userId: id, role }, prisma);
  if (!result.success) throw new Error(`Couldn't add ${email} to the test store`);
  return { id, headers: await signInHeaders(email, PASSWORD) };
}

interface OrderSpec {
  path: OrderStage[];
  fulfilmentType?: FulfilmentType;
  // Days from today (store time zone) for the scheduled pickup.
  pickupInDays?: number;
  window?: [string, string];
  revisionAwaitingApproval?: boolean;
}

// An order exactly as earlier moves would have left it. Written straight to
// the database, with a price, notes, and history the view must never show.
async function makeOrder(spec: OrderSpec): Promise<string> {
  const fulfilmentType = spec.fulfilmentType ?? "PICKUP_DELIVERY";
  const pickup = fulfilmentType === "PICKUP_DELIVERY";
  const stage = spec.path.at(-1) ?? "BOOKED";
  const start = Date.UTC(2026, 0, 1, 9);
  const at = (index: number) => new Date(start + index * 60_000);
  const [windowStart, windowEnd] = spec.window ?? ["10:00", "12:00"];

  const order = await prisma.order.create({
    data: {
      storeId: store.id,
      orderNumber: nextOrderNumber++,
      customerId,
      channel: "PHONE",
      fulfilmentType,
      stage,
      serviceAreaName: pickup ? "Lekki Phase 1" : null,
      addressText: pickup ? "12 Admiralty Way, Lekki" : null,
      pickupWindowStatus: pickup ? "CONFIRMED" : null,
      scheduledPickupDate: pickup ? fromDateKey(addDaysToDateKey(today, spec.pickupInDays ?? 0)) : null,
      scheduledWindowStart: pickup ? windowStart : null,
      scheduledWindowEnd: pickup ? windowEnd : null,
      fulfilmentCharge: pickup ? 100_000 : null,
      internalNote: "Gate code 4512",
      customerNote: "Please call on arrival",
      trackingTokenHash: randomUUID(),
      trackingTokenIssuedAt: at(0),
      createdAt: at(0),
    },
    select: { id: true },
  });
  const revision = (version: number, status: "APPROVED" | "PENDING") => ({
    storeId: store.id,
    orderId: order.id,
    version,
    linesSnapshot: [],
    itemsSubtotal: 500_000,
    total: 600_000,
    status,
    createdByActor: "STAFF" as const,
    createdByUserId: users.staff.id,
    approvedAt: status === "APPROVED" ? at(0) : null,
    approvedByActor: status === "APPROVED" ? ("STAFF" as const) : null,
  });
  const v1 = await prisma.quoteRevision.create({ data: revision(1, "APPROVED"), select: { id: true } });
  await prisma.order.update({ where: { id: order.id }, data: { approvedQuoteId: v1.id } });
  if (spec.revisionAwaitingApproval) await prisma.quoteRevision.create({ data: revision(2, "PENDING") });

  await prisma.statusEvent.createMany({
    data: spec.path.map((toStage, index) => ({
      storeId: store.id,
      orderId: order.id,
      fromStage: index === 0 ? null : spec.path[index - 1],
      toStage,
      actorType: "STAFF" as const,
      actorUserId: users.staff.id,
      createdAt: at(index + 1),
    })),
  });
  return order.id;
}

async function readOrder(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      stage: true,
      completedAt: true,
      statusEvents: { orderBy: { createdAt: "asc" }, select: { fromStage: true, toStage: true, actorType: true, actorUserId: true } },
    },
  });
}

function as(headers: Headers) {
  request.headers = headers;
}

const allCards = (sections: Awaited<ReturnType<typeof getDeliveries>>) => [
  ...sections.pickups,
  ...sections.onTheWay,
  ...sections.readyToDeliver,
];

describe("a rider's three moves", () => {
  it("picks up, sends out, and delivers, each writing a status event with the rider as actor", async () => {
    const orderId = await makeOrder({ path: upTo("PICKUP_SCHEDULED") });
    as(users.rider.headers);

    expect(await markPickedUp(orderId)).toEqual({ ok: true, message: "Marked picked up" });
    // Picked up: off the view until it is Ready.
    expect(allCards(await getDeliveries(store, new Date())).map((card) => card.orderId)).not.toContain(orderId);

    // The store washes and irons it.
    await prisma.order.update({ where: { id: orderId }, data: { stage: "READY" } });
    expect((await getDeliveries(store, new Date())).readyToDeliver.map((card) => card.orderId)).toContain(orderId);

    expect(await sendOutForDelivery(orderId)).toEqual({ ok: true, message: "Out for delivery" });
    expect((await getDeliveries(store, new Date())).onTheWay.map((card) => card.orderId)).toContain(orderId);

    expect(await markDelivered(orderId)).toEqual({ ok: true, message: "Marked delivered" });

    const order = await readOrder(orderId);
    expect(order.stage).toBe("COMPLETED");
    expect(order.completedAt).not.toBeNull();
    const riderEvents = order.statusEvents.filter((event) => event.actorUserId === users.rider.id);
    expect(riderEvents).toEqual([
      { fromStage: "PICKUP_SCHEDULED", toStage: "PICKED_UP", actorType: "STAFF", actorUserId: users.rider.id },
      { fromStage: "READY", toStage: "OUT_FOR_DELIVERY", actorType: "STAFF", actorUserId: users.rider.id },
      { fromStage: "OUT_FOR_DELIVERY", toStage: "COMPLETED", actorType: "STAFF", actorUserId: users.rider.id },
    ]);
  });

  it("can be made by owners and staff too", async () => {
    for (const member of [users.owner, users.staff]) {
      const orderId = await makeOrder({ path: upTo("READY") });
      as(member.headers);
      expect(await sendOutForDelivery(orderId)).toMatchObject({ ok: true });
      expect((await readOrder(orderId)).statusEvents.at(-1)).toMatchObject({ actorUserId: member.id });
    }
  });

  it("refuses every order not at the exact stage its button expects, saving nothing", async () => {
    as(users.rider.headers);
    for (const move of MOVES) {
      // Every other stage at once (all as the rider).
      await Promise.all(
        PICKUP_PATH.filter((stage) => stage !== move.from).map(async (stage) => {
          const orderId = await makeOrder({ path: upTo(stage) });
          expect(await move.action(orderId)).toEqual({ ok: false, code: "CONFLICT", message: CHANGED_MESSAGE });
          expect((await readOrder(orderId)).stage).toBe(stage);
        }),
      );
    }
  });

  it("refuses drop-off orders as if they didn't exist", async () => {
    as(users.rider.headers);
    const orderId = await makeOrder({ fulfilmentType: "DROP_OFF", path: ["RECEIVED_BY_STORE", "IN_PROGRESS", "READY"] });
    expect(await sendOutForDelivery(orderId)).toEqual(NOT_FOUND);
    expect((await readOrder(orderId)).stage).toBe("READY");
  });

  it("shows the plain reason when the rules refuse the move", async () => {
    as(users.rider.headers);
    const orderId = await makeOrder({ path: upTo("OUT_FOR_DELIVERY"), revisionAwaitingApproval: true });
    expect(await markDelivered(orderId)).toEqual({
      ok: false,
      code: "NOT_ALLOWED",
      message: "Waiting for the customer to approve the revised total.",
    });
    expect((await readOrder(orderId)).stage).toBe("OUT_FOR_DELIVERY");
  });

  it("refuses a malformed order ID like another store's order", async () => {
    as(users.rider.headers);
    expect(await markPickedUp("x".repeat(500))).toEqual(NOT_FOUND);
    expect(await markPickedUp({ id: "nope" })).toEqual(NOT_FOUND);
  });
});

describe("riders and the general stage-change action", () => {
  it("is refused for every move, even the three delivery moves", async () => {
    as(users.rider.headers);
    const cases: { path: OrderStage[]; to: OrderStage; note?: string; collectedByCustomer?: boolean }[] = [
      { path: upTo("PICKUP_SCHEDULED"), to: "PICKED_UP" },
      { path: upTo("READY"), to: "OUT_FOR_DELIVERY" },
      { path: upTo("OUT_FOR_DELIVERY"), to: "COMPLETED" },
      { path: upTo("OUT_FOR_DELIVERY"), to: "READY", note: "Step back" },
      { path: upTo("READY"), to: "CANCELLED", note: "Cancel" },
      { path: upTo("READY"), to: "COMPLETED", note: "Collected", collectedByCustomer: true },
      { path: upTo("COMPLETED"), to: "OUT_FOR_DELIVERY", note: "Reopen" },
      { path: upTo("PICKED_UP"), to: "RECEIVED_BY_STORE" },
    ];
    for (const { path, to, note, collectedByCustomer } of cases) {
      const orderId = await makeOrder({ path });
      const from = path.at(-1)!;
      const result = await changeOrderStage({ orderId, from, to, note: note ?? null, collectedByCustomer: collectedByCustomer ?? false });
      expect(result).toMatchObject({ ok: false, code: "NOT_ALLOWED_FOR_STORE" });
      expect((await readOrder(orderId)).stage).toBe(from);
    }
  });
});

describe("the Deliveries data", () => {
  it("returns only the card fields: no prices, totals, payments, notes, or history", async () => {
    const pickupId = await makeOrder({ path: upTo("PICKUP_SCHEDULED") });
    const readyId = await makeOrder({ path: upTo("READY") });
    const sections = await getDeliveries(store, new Date());
    expect(Object.keys(sections).sort()).toEqual(["onTheWay", "pickups", "readyToDeliver"]);

    const pickup = sections.pickups.find((card) => card.orderId === pickupId)!;
    expect(Object.keys(pickup).sort()).toEqual(PICKUP_CARD_FIELDS.sort());
    expect(pickup).toMatchObject({ orderNumber: expect.stringMatching(/^DT-\d+$/), scheduledDate: today, isOverdue: false });
    const ready = sections.readyToDeliver.find((card) => card.orderId === readyId)!;
    expect(Object.keys(ready).sort()).toEqual(CARD_FIELDS.sort());

    const text = JSON.stringify(sections);
    for (const secret of ["Gate code", "call on arrival", "600000", "500000", "100000", "statusEvents", "total"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("shows overdue pickups first, then today's by window, and never later ones or drop-off orders", async () => {
    const late = await makeOrder({ path: upTo("PICKUP_SCHEDULED"), window: ["16:00", "18:00"] });
    const early = await makeOrder({ path: upTo("PICKUP_SCHEDULED"), window: ["06:00", "07:00"] });
    const overdue = await makeOrder({ path: upTo("PICKUP_SCHEDULED"), pickupInDays: -1, window: ["18:00", "20:00"] });
    const tomorrow = await makeOrder({ path: upTo("PICKUP_SCHEDULED"), pickupInDays: 1 });
    const dropOff = await makeOrder({ fulfilmentType: "DROP_OFF", path: ["RECEIVED_BY_STORE", "IN_PROGRESS", "READY"] });

    const { pickups, readyToDeliver } = await getDeliveries(store, new Date());
    const ids = pickups.map((card) => card.orderId);
    expect(ids).not.toContain(tomorrow);
    expect(ids.indexOf(overdue)).toBeLessThan(ids.indexOf(early));
    expect(ids.indexOf(early)).toBeLessThan(ids.indexOf(late));
    expect(pickups.find((card) => card.orderId === overdue)?.isOverdue).toBe(true);
    expect(readyToDeliver.map((card) => card.orderId)).not.toContain(dropOff);
  });
});

describe("store isolation", () => {
  it("a FreshFold rider sees no CleanWave orders and can't move one, even by sending its ID", async () => {
    const [freshFold, cleanWave] = await Promise.all(
      ["freshfold-laundry", "cleanwave-laundry"].map((slug) =>
        prisma.store.findUniqueOrThrow({ where: { slug }, select: { id: true, orderPrefix: true, timeZone: true } }),
      ),
    );
    const cleanWaveOrders = await prisma.order.findMany({ where: { storeId: cleanWave.id }, select: { id: true, stage: true } });

    const ids = allCards(await getDeliveries(freshFold, new Date())).map((card) => card.orderId);
    for (const order of cleanWaveOrders) expect(ids).not.toContain(order.id);

    as(freshFoldRider);
    for (const order of cleanWaveOrders) {
      for (const move of MOVES) expect(await move.action(order.id)).toEqual(NOT_FOUND);
    }
    const after = await prisma.order.findMany({ where: { storeId: cleanWave.id }, select: { id: true, stage: true } });
    expect(after).toEqual(expect.arrayContaining(cleanWaveOrders));
  });
});

describe("two people moving the same order at the same moment", () => {
  it("lets exactly one through", async () => {
    const orderId = await makeOrder({ path: upTo("PICKUP_SCHEDULED") });
    // Each action reads the session when it starts, so set it per call.
    const results = await Promise.all([
      (async () => {
        as(users.rider.headers);
        return markPickedUp(orderId);
      })(),
      (async () => {
        as(users.staff.headers);
        return markPickedUp(orderId);
      })(),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: "CONFLICT", message: CHANGED_MESSAGE }]);
    const order = await readOrder(orderId);
    expect(order.statusEvents.filter((event) => event.toStage === "PICKED_UP")).toHaveLength(1);
  });
});
