import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { toMatchKey } from "@/lib/match-key";
import type { CreateOrderRequest } from "@/schemas/orders";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { insertOrder } from "@/server/data/orders";
import { createUserWithPassword } from "@/server/data/users";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { createOrder } from "./orders";

// The action reads the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Each test creates orders through several Neon round trips (slow from here).
vi.setConfig({ testTimeout: 60_000 });

// Orders are created in a throwaway store with its own owner and staff, so the
// seeded stores' order numbers (checked by the seed tests) never move.
const EMAIL_DOMAIN = "order-entry-test.example";
const PASSWORD = "test-password-1234";

// 2099-06-15 is a Monday. The store picks up Monday–Friday, 8:00 AM–5:00 PM,
// and is closed on Tuesday 2099-06-16.
const MONDAY = "2099-06-15";
const CLOSED_TUESDAY = "2099-06-16";
const SUNDAY = "2099-06-21";

let prisma: PrismaClient;
let store: { id: string };
let ids: { shirt: string; wash: string; inspect: string; fixedArea: string; quoteArea: string };
let signedIn: Record<"owner" | "staff" | "freshFoldStaff", Headers>;
let cleanWave: { customerId: string; serviceId: string; areaId: string };
let freshFold: { storeId: string; serviceId: string; customerId: string };

beforeAll(async () => {
  prisma = createTestPrisma();
  const suffix = randomUUID().slice(0, 8);
  store = await prisma.store.create({
    data: {
      name: "Order Entry Test Laundry",
      slug: `order-entry-test-${suffix}`,
      orderPrefix: "OE",
      dropOffEnabled: true,
      pickupDeliveryEnabled: true,
      activeDays: [1, 2, 3, 4, 5],
      openTime: "08:00",
      closeTime: "17:00",
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      closedDates: { create: { date: new Date(`${CLOSED_TUESDAY}T00:00:00.000Z`), note: "Test closure" } },
    },
    select: { id: true },
  });
  const service = (name: string, pricingType: "PER_ITEM" | "PER_KG", price: number, requiresQuote = false) =>
    prisma.service.create({
      data: { storeId: store.id, name, nameKey: toMatchKey(name), pricingType, price, requiresQuote },
      select: { id: true },
    });
  const area = (name: string, fixedCharge: number | null) =>
    prisma.serviceArea.create({
      data: {
        storeId: store.id,
        name,
        nameKey: toMatchKey(name),
        chargeType: fixedCharge === null ? "QUOTE_REQUIRED" : "FIXED",
        fixedCharge,
      },
      select: { id: true },
    });
  const [shirt, wash, inspect, fixedArea, quoteArea] = await Promise.all([
    service("Shirt", "PER_ITEM", 80_000),
    service("Wash & fold", "PER_KG", 150_000, true),
    service("Agbada (inspect)", "PER_ITEM", 500_000, true),
    area("Wuse 2", 150_000),
    area("Maitama", null),
  ]);
  ids = { shirt: shirt.id, wash: wash.id, inspect: inspect.id, fixedArea: fixedArea.id, quoteArea: quoteArea.id };

  const owner = await addUser("owner", "OWNER");
  const staff = await addUser("staff", "STAFF");
  signedIn = {
    owner: await signInHeaders(owner, PASSWORD),
    staff: await signInHeaders(staff, PASSWORD),
    freshFoldStaff: await signInHeaders("kemi@freshfold.example"),
  };

  const [cw, ff] = await Promise.all(
    ["cleanwave-laundry", "freshfold-laundry"].map((slug) =>
      prisma.store.findUniqueOrThrow({
        where: { slug },
        select: {
          id: true,
          customers: { take: 1, select: { id: true } },
          services: { where: { isActive: true, pricingType: "PER_ITEM", requiresQuote: false }, take: 1, select: { id: true } },
          serviceAreas: { where: { isActive: true }, take: 1, select: { id: true } },
        },
      }),
    ),
  );
  cleanWave = { customerId: cw.customers[0].id, serviceId: cw.services[0].id, areaId: cw.serviceAreas[0].id };
  freshFold = { storeId: ff.id, serviceId: ff.services[0].id, customerId: ff.customers[0].id };
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, customers, or users.
  const where = { storeId: store.id };
  await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
  await prisma.$transaction(
    [
      prisma.statusEvent.deleteMany({ where }),
      prisma.quoteRevision.deleteMany({ where }),
      prisma.orderLine.deleteMany({ where }),
      prisma.order.deleteMany({ where }),
      prisma.customer.deleteMany({ where }),
      prisma.service.deleteMany({ where }),
      prisma.serviceArea.deleteMany({ where }),
      prisma.closedDate.deleteMany({ where }),
      prisma.subscription.deleteMany({ where }),
      prisma.membership.deleteMany({ where }),
    ],
    { maxWait: 15_000, timeout: 30_000 },
  );
  const users = { email: { endsWith: `@${EMAIL_DOMAIN}` } };
  const userIds = (await prisma.user.findMany({ where: users, select: { id: true } })).map((user) => user.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function addUser(label: string, role: "OWNER" | "STAFF"): Promise<string> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const { id } = await createUserWithPassword({ name: `Test ${label}`, email, password: PASSWORD }, prisma);
  const result = await createMembership(store.id, { userId: id, role }, prisma);
  if (!result.success) throw new Error(`Couldn't add ${email} to the test store`);
  return email;
}

// A new customer's phone number no other test uses (Nigerian mobile format).
function newPhone(): string {
  return `+234803${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

function counterOrder(overrides: Partial<CreateOrderRequest> = {}): CreateOrderRequest {
  return {
    clientRequestId: randomUUID(),
    customer: { kind: "new", name: "Test Customer", phone: newPhone(), email: "" },
    channel: "COUNTER",
    fulfilmentType: "DROP_OFF",
    pickup: null,
    serviceLines: [{ serviceId: ids.shirt, quantity: "3", estimate: "" }],
    adjustments: [],
    internalNote: "",
    ...overrides,
  };
}

function pickupOrder(pickup: Partial<NonNullable<CreateOrderRequest["pickup"]>> = {}, overrides: Partial<CreateOrderRequest> = {}) {
  return counterOrder({
    channel: "PHONE",
    fulfilmentType: "PICKUP_DELIVERY",
    pickup: {
      area: { kind: "area", areaId: ids.fixedArea },
      address: "12 Test Street",
      date: MONDAY,
      outsideSchedule: false,
      windowStart: "08:00",
      windowEnd: "10:00",
      charge: "",
      ...pickup,
    },
    ...overrides,
  });
}

async function createAs(who: keyof typeof signedIn, order: unknown) {
  request.headers = signedIn[who];
  return createOrder(order);
}

async function created(who: keyof typeof signedIn, order: CreateOrderRequest) {
  const result = await createAs(who, order);
  if (!result.ok) throw new Error(`Expected an order, got ${result.code}: ${JSON.stringify(result.fieldErrors)}`);
  return loadOrder(result.orderId);
}

function loadOrder(id: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id },
    include: {
      lines: { orderBy: { id: "asc" } },
      quoteRevisions: true,
      statusEvents: true,
      customer: true,
      approvedQuote: true,
    },
  });
}

async function nextOrderNumber(storeId = store.id): Promise<number> {
  return (await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { nextOrderNumber: true } }))
    .nextOrderNumber;
}

describe("access", () => {
  it("lets staff and owners create orders", async () => {
    for (const who of ["staff", "owner"] as const) {
      const order = await created(who, counterOrder());
      expect(order.storeId).toBe(store.id);
      expect(order.createdByUserId).not.toBeNull();
    }
  });

  it("refuses creation when the store isn't accepting new orders", async () => {
    await prisma.store.update({ where: { id: store.id }, data: { status: "PAUSED" } });
    try {
      const before = await nextOrderNumber();
      const order = counterOrder();
      const result = await createAs("staff", order);
      expect(result).toMatchObject({ ok: false, code: "STORE_NOT_ACCEPTING_ORDERS" });
      expect(await prisma.order.count({ where: { clientRequestId: order.clientRequestId } })).toBe(0);
      expect(await nextOrderNumber()).toBe(before);
    } finally {
      await prisma.store.update({ where: { id: store.id }, data: { status: "ACTIVE" } });
    }
  });

  it("refuses a request without a request ID", async () => {
    for (const clientRequestId of [undefined, "", "not-a-uuid"]) {
      const result = await createAs("staff", { ...counterOrder(), clientRequestId });
      expect(result).toMatchObject({ ok: false, code: "REQUEST_ID_REQUIRED" });
    }
  });
});

describe("store isolation", () => {
  it("doesn't let a FreshFold user use a CleanWave customer, service, or area", async () => {
    const before = await nextOrderNumber(freshFold.storeId);
    const ownLine = [{ serviceId: freshFold.serviceId, quantity: "1", estimate: "" }];
    const attempts = [
      counterOrder({ customer: { kind: "existing", customerId: cleanWave.customerId }, serviceLines: ownLine }),
      counterOrder({
        customer: { kind: "existing", customerId: freshFold.customerId },
        serviceLines: [{ serviceId: cleanWave.serviceId, quantity: "1", estimate: "" }],
      }),
      {
        ...pickupOrder({ area: { kind: "area", areaId: cleanWave.areaId }, charge: "0" }),
        customer: { kind: "existing" as const, customerId: freshFold.customerId },
        serviceLines: ownLine,
      },
    ];
    const codes = [];
    for (const attempt of attempts) {
      const result = await createAs("freshFoldStaff", attempt);
      expect(result.ok).toBe(false);
      if (!result.ok) codes.push(result.code);
      expect(await prisma.order.count({ where: { clientRequestId: attempt.clientRequestId } })).toBe(0);
    }
    // The pickup attempt may be refused for its area or for FreshFold's own
    // pickup settings; either way the CleanWave area is never used.
    expect(codes.slice(0, 2)).toEqual(["CUSTOMER_NOT_FOUND", "SERVICE_UNAVAILABLE"]);
    expect(["AREA_UNAVAILABLE", "FULFILMENT_NOT_OFFERED"]).toContain(codes[2]);
    expect(await nextOrderNumber(freshFold.storeId)).toBe(before);
  });
});

describe("creating an order", () => {
  it("writes the number, lines, version 1, first status event, and token hash together", async () => {
    const order = await created("staff", counterOrder({ internalNote: " Starch the collars " }));
    expect(order.orderNumber).toBeGreaterThanOrEqual(1001);
    expect(order.stage).toBe("RECEIVED_BY_STORE");
    expect(order.channel).toBe("COUNTER");
    expect(order.internalNote).toBe("Starch the collars");
    expect(order.trackingTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ description: "Shirt", unitPrice: 80_000, lineTotal: 240_000 });
    expect(order.lines[0].quantity?.toString()).toBe("3");
    expect(order.quoteRevisions).toHaveLength(1);
    expect(order.quoteRevisions[0]).toMatchObject({ version: 1, total: 240_000, createdByActor: "STAFF" });
    expect(order.statusEvents).toEqual([
      expect.objectContaining({ fromStage: null, toStage: "RECEIVED_BY_STORE", actorType: "STAFF" }),
    ]);
  });

  it("keeps nothing, and uses no number, when any part fails", async () => {
    const before = await nextOrderNumber();
    const clientRequestId = randomUUID();
    const phone = newPhone();
    // A per-kg line without the quote flag breaks OrderLine_per_kg_requires_quote
    // after the number, customer, and order have been written.
    await expect(
      insertOrder(store.id, {
        clientRequestId,
        customer: { kind: "new", name: "Rollback Test", phone, email: null },
        channel: "COUNTER",
        fulfilmentType: "DROP_OFF",
        stage: "RECEIVED_BY_STORE",
        serviceAreaId: null,
        serviceAreaName: null,
        isOutOfArea: false,
        isOutsideSchedule: false,
        fulfilmentCharge: null,
        addressText: null,
        pickup: null,
        trackingTokenHash: randomUUID(),
        internalNote: null,
        lines: [
          {
            lineType: "SERVICE",
            serviceId: ids.wash,
            description: "Wash & fold",
            pricingType: "PER_KG",
            requiresQuote: false,
            unitPrice: 150_000,
            estimatedQuantity: null,
            quantity: "2.00",
            lineTotal: 300_000,
          },
        ],
        revision: { linesSnapshot: [], itemsSubtotal: 300_000, fulfilmentCharge: 0, total: 300_000, approved: true },
        actor: { type: "STAFF", userId: null },
        now: new Date(),
      }),
    ).rejects.toThrow(/OrderLine_per_kg_requires_quote/);

    expect(await prisma.order.count({ where: { clientRequestId } })).toBe(0);
    expect(await prisma.customer.count({ where: { storeId: store.id, phone } })).toBe(0);
    expect(await nextOrderNumber()).toBe(before);
  });

  it("approves version 1 at once when the order is fully priced", async () => {
    const order = await created(
      "staff",
      counterOrder({
        serviceLines: [
          { serviceId: ids.shirt, quantity: "2", estimate: "" },
          { serviceId: ids.wash, quantity: "2.5", estimate: "" },
        ],
      }),
    );
    const [version1] = order.quoteRevisions;
    expect(version1).toMatchObject({ status: "APPROVED", approvedByActor: "STAFF", total: 160_000 + 375_000 });
    expect(version1.approvedAt).not.toBeNull();
    expect(order.approvedQuoteId).toBe(version1.id);
  });

  it("leaves version 1 unapproved while a per-kg line is unweighed", async () => {
    const order = await created(
      "staff",
      counterOrder({
        serviceLines: [
          { serviceId: ids.shirt, quantity: "2", estimate: "" },
          { serviceId: ids.wash, quantity: "", estimate: "3" },
        ],
      }),
    );
    const wash = order.lines.find((line) => line.serviceId === ids.wash);
    expect(wash).toMatchObject({ requiresQuote: true, quantity: null, lineTotal: null });
    expect(wash?.estimatedQuantity?.toString()).toBe("3");
    expect(order.quoteRevisions[0]).toMatchObject({ status: "PENDING", approvedAt: null, total: 160_000 + 450_000 });
    expect(order.approvedQuoteId).toBeNull();
    expect(order.stage).toBe("RECEIVED_BY_STORE");
  });

  it("combines a service added twice into one line", async () => {
    const order = await created(
      "staff",
      counterOrder({
        serviceLines: [
          { serviceId: ids.shirt, quantity: "2", estimate: "" },
          { serviceId: ids.shirt, quantity: "3", estimate: "" },
        ],
      }),
    );
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0].quantity?.toString()).toBe("5");
    expect(order.lines[0].lineTotal).toBe(400_000);
  });

  it("stores Others as signed amounts and refuses a negative total", async () => {
    const order = await created(
      "staff",
      counterOrder({
        adjustments: [
          { description: "Express", kind: "CHARGE", amount: "500" },
          { description: "Loyalty", kind: "DISCOUNT", amount: "1,000" },
        ],
      }),
    );
    const others = order.lines.filter((line) => line.lineType === "ADJUSTMENT").map((line) => line.lineTotal);
    expect(others.sort()).toEqual([-100_000, 50_000]);
    expect(order.quoteRevisions[0].total).toBe(240_000 - 50_000);

    const negative = counterOrder({ adjustments: [{ description: "Too much", kind: "DISCOUNT", amount: "5,000" }] });
    expect(await createAs("staff", negative)).toMatchObject({ ok: false, code: "NEGATIVE_TOTAL" });
    expect(await prisma.order.count({ where: { clientRequestId: negative.clientRequestId } })).toBe(0);
  });

  it("ignores prices and charges sent by the browser", async () => {
    const result = await createAs("staff", {
      ...pickupOrder({ charge: "1" }),
      serviceLines: [{ serviceId: ids.shirt, quantity: "1", estimate: "", unitPrice: 1, lineTotal: 1 }],
    });
    if (!result.ok) throw new Error(`Expected an order, got ${result.code}`);
    const order = await loadOrder(result.orderId);
    expect(order.lines[0]).toMatchObject({ unitPrice: 80_000, lineTotal: 80_000 });
    expect(order.fulfilmentCharge).toBe(150_000);
    expect(order.quoteRevisions[0]).toMatchObject({ fulfilmentCharge: 150_000, total: 230_000 });
  });

  it("keeps its copies when the service or area changes later", async () => {
    const order = await created("staff", pickupOrder());
    await prisma.service.update({ where: { id: ids.shirt }, data: { name: "Shirt (renamed)", price: 99_900 } });
    await prisma.serviceArea.update({ where: { id: ids.fixedArea }, data: { name: "Wuse II", fixedCharge: 300_000 } });
    try {
      const after = await loadOrder(order.id);
      expect(after.lines[0]).toMatchObject({ description: "Shirt", unitPrice: 80_000, lineTotal: 240_000 });
      expect(after).toMatchObject({ serviceAreaName: "Wuse 2", fulfilmentCharge: 150_000 });
    } finally {
      await prisma.service.update({ where: { id: ids.shirt }, data: { name: "Shirt", price: 80_000 } });
      await prisma.serviceArea.update({ where: { id: ids.fixedArea }, data: { name: "Wuse 2", fixedCharge: 150_000 } });
    }
  });
});

describe("customers", () => {
  it("reuses the customer with the same phone, without renaming them", async () => {
    const phone = newPhone();
    const first = await created("staff", counterOrder({ customer: { kind: "new", name: "Original Name", phone, email: "" } }));
    const second = await created("staff", counterOrder({ customer: { kind: "new", name: "Other Name", phone, email: "" } }));
    expect(second.customerId).toBe(first.customerId);
    expect(second.customer.name).toBe("Original Name");
  });

  it("shares one customer between two orders created at once for the same new number", async () => {
    const phone = newPhone();
    const customer = { kind: "new" as const, name: "Same Time", phone, email: "" };
    request.headers = signedIn.staff;
    const results = await Promise.all([createOrder(counterOrder({ customer })), createOrder(counterOrder({ customer }))]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await prisma.customer.count({ where: { storeId: store.id, phone } })).toBe(1);
    expect(await prisma.order.count({ where: { storeId: store.id, customer: { phone } } })).toBe(2);
  });
});

describe("double submits", () => {
  it("returns the same order to two creates with the same request ID", async () => {
    const before = await nextOrderNumber();
    const order = counterOrder();
    request.headers = signedIn.staff;
    const [a, b] = await Promise.all([createOrder(order), createOrder(order)]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.orderId).toBe(b.orderId);
    expect(await prisma.order.count({ where: { clientRequestId: order.clientRequestId } })).toBe(1);
    // The refused second transaction rolled back, so it used no number.
    expect(await nextOrderNumber()).toBe(before + 1);
  });

  it("gives concurrent creates with different IDs different numbers", async () => {
    request.headers = signedIn.staff;
    const results = await Promise.all([1, 2, 3].map(() => createOrder(counterOrder())));
    const orderIds = results.map((result) => (result.ok ? result.orderId : ""));
    const orders = await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { orderNumber: true } });
    expect(new Set(orders.map((order) => order.orderNumber)).size).toBe(3);
  });
});

describe("pickup & delivery", () => {
  it("schedules a fixed-area pickup with the area's charge and a confirmed window", async () => {
    const order = await created("staff", pickupOrder());
    expect(order).toMatchObject({
      stage: "PICKUP_SCHEDULED",
      serviceAreaId: ids.fixedArea,
      serviceAreaName: "Wuse 2",
      isOutOfArea: false,
      fulfilmentCharge: 150_000,
      addressText: "12 Test Street",
      requestedWindowStart: "08:00",
      requestedWindowEnd: "10:00",
      scheduledWindowStart: "08:00",
      scheduledWindowEnd: "10:00",
      pickupWindowStatus: "CONFIRMED",
      isOutsideSchedule: false,
    });
    expect(order.scheduledPickupDate?.toISOString().slice(0, 10)).toBe(MONDAY);
    expect(order.approvedQuoteId).not.toBeNull();
  });

  it("needs the agreed charge for a quote-required area", async () => {
    const missing = pickupOrder({ area: { kind: "area", areaId: ids.quoteArea } });
    expect(await createAs("staff", missing)).toMatchObject({ ok: false, code: "CHARGE_REQUIRED" });
    const order = await created("staff", pickupOrder({ area: { kind: "area", areaId: ids.quoteArea }, charge: "0" }));
    expect(order.fulfilmentCharge).toBe(0);
  });

  it("keeps an out-of-area name on the order only", async () => {
    const order = await created(
      "staff",
      pickupOrder({ area: { kind: "outOfArea", name: "Gwarinpa" }, charge: "2,500" }, { channel: "WHATSAPP" }),
    );
    expect(order).toMatchObject({ serviceAreaId: null, serviceAreaName: "Gwarinpa", isOutOfArea: true, fulfilmentCharge: 250_000 });
    expect(await prisma.serviceArea.count({ where: { storeId: store.id, name: "Gwarinpa" } })).toBe(0);
  });

  it("refuses an out-of-area pickup when the store has pickup & delivery turned off", async () => {
    await prisma.store.update({ where: { id: store.id }, data: { pickupDeliveryEnabled: false } });
    try {
      const order = pickupOrder({ area: { kind: "outOfArea", name: "Gwarinpa" }, charge: "0" });
      expect(await createAs("staff", order)).toMatchObject({ ok: false, code: "FULFILMENT_NOT_OFFERED" });
    } finally {
      await prisma.store.update({ where: { id: store.id }, data: { pickupDeliveryEnabled: true } });
    }
  });

  it("refuses a closed date, an inactive day, or a time outside the windows", async () => {
    for (const pickup of [
      { date: CLOSED_TUESDAY },
      { date: SUNDAY },
      { windowStart: "19:00", windowEnd: "21:00" },
    ]) {
      const result = await createAs("staff", pickupOrder(pickup));
      expect(result).toMatchObject({ ok: false, code: "PICKUP_NOT_AVAILABLE" });
    }
  });

  it("allows those outside the normal schedule, with a note", async () => {
    const sunday = { date: SUNDAY, outsideSchedule: true, windowStart: "19:00", windowEnd: "20:00" };
    expect(await createAs("staff", pickupOrder(sunday))).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const order = await created("staff", pickupOrder(sunday, { internalNote: "Customer asked for Sunday 7 PM" }));
    expect(order).toMatchObject({
      isOutsideSchedule: true,
      scheduledWindowStart: "19:00",
      scheduledWindowEnd: "20:00",
      stage: "PICKUP_SCHEDULED",
    });
    const closed = await created("staff", pickupOrder({ ...sunday, date: CLOSED_TUESDAY }, { internalNote: "Agreed" }));
    expect(closed.isOutsideSchedule).toBe(true);
  });
});
