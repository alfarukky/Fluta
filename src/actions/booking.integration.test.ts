import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { CLIENT_IP_HEADER, hashClientIp } from "@/lib/client-ip";
import { toMatchKey } from "@/lib/match-key";
import { hashToken } from "@/lib/tokens";
import type { BookingRequest } from "@/schemas/booking";
import { getPrisma } from "@/server/data/client";
import { loadBookingPage } from "@/server/services/booking";
import { getOrderDetail } from "@/server/services/orders";
import { createTestPrisma } from "@/test/integration/db";

import { createBooking } from "./booking";

// The action reads the visitor's IP from next/headers: here, whatever the
// test sets.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

// Each booking makes several Neon round trips (slow from here).
vi.setConfig({ testTimeout: 90_000 });

// "Now" is Monday 2099-06-15, 7:00 AM in Lagos. Only Date is faked, so the
// database driver's timers keep running. Bookings are made in throwaway
// stores, so the seeded stores' order numbers never move.
const MONDAY_7AM = new Date("2099-06-15T06:00:00.000Z");
const MONDAY = "2099-06-15";
const CLOSED_TUESDAY = "2099-06-16";
const WEDNESDAY = "2099-06-17";

let prisma: PrismaClient;
let main: TestStore;
let other: TestStore;

interface TestStore {
  id: string;
  slug: string;
  shirt: string;
  bedding: string;
  inspect: string;
  disabled: string;
  fixedArea: string;
  quoteArea: string;
  disabledArea: string;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  [main, other] = await Promise.all([createStore("Booking Test Laundry", "BT"), createStore("Other Booking Laundry", "OB")]);
}, 120_000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MONDAY_7AM);
  request.headers = new Headers({ [CLIENT_IP_HEADER]: newIp() });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  // Test cleanup only: the app never deletes orders or customers.
  for (const store of [main, other]) {
    const where = { storeId: store.id };
    await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
    await prisma.$transaction(
      [
        prisma.auditEvent.deleteMany({ where }),
        prisma.messageEvent.deleteMany({ where }),
        prisma.statusEvent.deleteMany({ where }),
        prisma.quoteRevision.deleteMany({ where }),
        prisma.orderLine.deleteMany({ where }),
        prisma.notification.deleteMany({ where }),
        prisma.order.deleteMany({ where }),
        prisma.customer.deleteMany({ where }),
        prisma.service.deleteMany({ where }),
        prisma.serviceArea.deleteMany({ where }),
        prisma.closedDate.deleteMany({ where }),
        prisma.subscription.deleteMany({ where }),
        prisma.store.delete({ where: { id: store.id } }),
      ],
      { maxWait: 15_000, timeout: 30_000 },
    );
  }
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

// Drop-off and pickup Monday–Friday, 8:00 AM–5:00 PM, closed on Tuesday
// 2099-06-16. Shirts have a fixed price; bedding and an inspected item are
// quote-required (priced by the store after counting).
async function createStore(name: string, orderPrefix: string): Promise<TestStore> {
  const slug = `booking-test-${randomUUID().slice(0, 8)}`;
  const { id } = await prisma.store.create({
    data: {
      name,
      slug,
      orderPrefix,
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
  const service = (serviceName: string, pricingType: "PER_ITEM" | "PER_PACKAGE", price: number, requiresQuote = false, isActive = true) =>
    prisma.service.create({
      data: { storeId: id, name: serviceName, nameKey: toMatchKey(serviceName), pricingType, price, requiresQuote, isActive },
      select: { id: true },
    });
  const area = (areaName: string, fixedCharge: number | null, isActive = true) =>
    prisma.serviceArea.create({
      data: {
        storeId: id,
        name: areaName,
        nameKey: toMatchKey(areaName),
        chargeType: fixedCharge === null ? "QUOTE_REQUIRED" : "FIXED",
        fixedCharge,
        isActive,
      },
      select: { id: true },
    });
  const [shirt, bedding, inspect, disabled, fixedArea, quoteArea, disabledArea] = await Promise.all([
    service("Shirt", "PER_ITEM", 80_000),
    service("Bedding (inspect)", "PER_PACKAGE", 150_000, true),
    service("Agbada (inspect)", "PER_ITEM", 500_000, true),
    service("Old service", "PER_ITEM", 10_000, false, false),
    area("Wuse 2", 150_000),
    area("Maitama", null),
    area("Old area", 50_000, false),
  ]);
  return {
    id,
    slug,
    shirt: shirt.id,
    bedding: bedding.id,
    inspect: inspect.id,
    disabled: disabled.id,
    fixedArea: fixedArea.id,
    quoteArea: quoteArea.id,
    disabledArea: disabledArea.id,
  };
}

// A phone number and an IP address no other test uses.
function newPhone(): string {
  return `+234803${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

function newIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

function dropOff(store: TestStore = main, overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    clientRequestId: randomUUID(),
    serviceLines: [{ serviceId: store.shirt, amount: "3" }],
    fulfilmentType: "DROP_OFF",
    pickup: null,
    customer: { name: "Ada Obi", phone: newPhone(), email: "" },
    ...overrides,
  };
}

function pickup(
  details: Partial<NonNullable<BookingRequest["pickup"]>> = {},
  overrides: Partial<BookingRequest> = {},
): BookingRequest {
  return dropOff(main, {
    fulfilmentType: "PICKUP_DELIVERY",
    pickup: { areaId: main.fixedArea, address: "12 Test Street", date: MONDAY, windowStart: "10:00", windowEnd: "12:00", ...details },
    ...overrides,
  });
}

async function book(booking: BookingRequest, store: TestStore = main) {
  const result = await createBooking(store.slug, booking);
  if (!result.ok) throw new Error(`Booking refused: ${result.code}`);
  return findOrder(store, booking.clientRequestId);
}

async function findOrder(store: TestStore, clientRequestId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { storeId_clientRequestId: { storeId: store.id, clientRequestId } },
    include: { lines: true, quoteRevisions: true, statusEvents: true, customer: true },
  });
}

// Earlier online bookings that count towards the limits, inserted directly
// (a booking through the action takes several Neon round trips). Each gets the
// next order numbers, a customer with this phone, and this IP hash.
async function insertPastBookings(store: TestStore, count: number, { phone, ipHash }: { phone: string; ipHash: string }) {
  const { nextOrderNumber } = await prisma.store.update({
    where: { id: store.id },
    data: { nextOrderNumber: { increment: count } },
    select: { nextOrderNumber: true },
  });
  const customer = await prisma.customer.upsert({
    where: { storeId_phone: { storeId: store.id, phone } },
    create: { storeId: store.id, name: "Earlier Booking", phone },
    update: {},
    select: { id: true },
  });
  await prisma.order.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      storeId: store.id,
      orderNumber: nextOrderNumber - count + i,
      customerId: customer.id,
      channel: "ONLINE" as const,
      fulfilmentType: "DROP_OFF" as const,
      trackingTokenHash: randomUUID(),
      trackingTokenIssuedAt: new Date(),
      bookingIpHash: ipHash,
      createdAt: new Date(),
    })),
  });
}

function currentIpHash(): string {
  return hashClientIp(request.headers.get(CLIENT_IP_HEADER));
}

async function orderCount(store: TestStore = main): Promise<number> {
  return prisma.order.count({ where: { storeId: store.id } });
}

describe("creating an online order", () => {
  it("creates a fully priced booking at Booked, with version 1 approved by the customer", async () => {
    const order = await book(dropOff());

    expect(order).toMatchObject({
      channel: "ONLINE",
      stage: "BOOKED",
      fulfilmentType: "DROP_OFF",
      createdByUserId: null,
      payLater: true,
      bookingIpHash: hashClientIp(request.headers.get(CLIENT_IP_HEADER)),
    });
    expect(order.trackingTokenHash).toMatch(/^[\w-]+$/);
    expect(order.lines).toEqual([
      expect.objectContaining({ description: "Shirt", unitPrice: 80_000, lineTotal: 240_000, estimatedQuantity: null }),
    ]);
    const [v1] = order.quoteRevisions;
    expect(v1).toMatchObject({
      version: 1,
      status: "APPROVED",
      total: 240_000,
      createdByActor: "CUSTOMER",
      createdByUserId: null,
      approvedByActor: "CUSTOMER",
    });
    expect(order.approvedQuoteId).toBe(v1.id);
    expect(order.statusEvents).toEqual([
      expect.objectContaining({ fromStage: null, toStage: "BOOKED", actorType: "CUSTOMER", actorUserId: null }),
    ]);
    // The staff bell hears about it once.
    expect(await prisma.notification.findMany({ where: { orderId: order.id }, select: { storeId: true, type: true, sourceId: true, audience: true } })).toEqual([
      { storeId: main.id, type: "ONLINE_BOOKING", sourceId: order.id, audience: "STAFF_AND_OWNERS" },
    ]);
  });

  it("keeps a quote-required booking as an unapproved estimate", async () => {
    const order = await book(
      dropOff(main, {
        serviceLines: [
          { serviceId: main.bedding, amount: "3" },
          { serviceId: main.inspect, amount: "2" },
        ],
      }),
    );

    expect(order.approvedQuoteId).toBeNull();
    expect(order.quoteRevisions).toEqual([
      expect.objectContaining({ version: 1, status: "PENDING", approvedAt: null, createdByActor: "CUSTOMER" }),
    ]);
    // The customer's amounts are estimates on both lines, never billed.
    expect(order.lines.map((line) => [line.description, line.quantity, line.estimatedQuantity?.toString()])).toEqual([
      ["Bedding (inspect)", null, "3"],
      ["Agbada (inspect)", null, "2"],
    ]);
  });

  it("saves a pickup's requested window as Requested and copies a fixed area's charge", async () => {
    const order = await book(pickup());

    expect(order).toMatchObject({
      stage: "BOOKED",
      serviceAreaId: main.fixedArea,
      serviceAreaName: "Wuse 2",
      fulfilmentCharge: 150_000,
      addressText: "12 Test Street",
      requestedPickupDate: new Date(`${MONDAY}T00:00:00.000Z`),
      requestedWindowStart: "10:00",
      requestedWindowEnd: "12:00",
      scheduledPickupDate: null,
      scheduledWindowStart: null,
      pickupWindowStatus: "REQUESTED",
      isOutsideSchedule: false,
    });
    expect(order.quoteRevisions[0]).toMatchObject({ status: "APPROVED", total: 240_000 + 150_000 });
  });

  it("leaves a quote-required area's charge empty for the store to set", async () => {
    const order = await book(pickup({ areaId: main.quoteArea }));

    expect(order.fulfilmentCharge).toBeNull();
    expect(order.approvedQuoteId).toBeNull();
    expect(order.quoteRevisions[0]).toMatchObject({ status: "PENDING", approvedAt: null });
  });

  it("ignores prices, charges, and staff fields the request sends", async () => {
    const booking = {
      ...pickup(),
      serviceLines: [{ serviceId: main.shirt, amount: "3", price: 1, unitPrice: 1, lineTotal: 1 }],
      pickup: { ...pickup().pickup, charge: "0", fulfilmentCharge: 0, outsideSchedule: true },
      channel: "COUNTER",
      adjustments: [{ description: "Discount", kind: "DISCOUNT", amount: "2400" }],
      total: 1,
    } as unknown as BookingRequest;
    const order = await book(booking);

    expect(order.channel).toBe("ONLINE");
    expect(order.isOutsideSchedule).toBe(false);
    expect(order.fulfilmentCharge).toBe(150_000);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ unitPrice: 80_000, lineTotal: 240_000 });
  });

  it("refuses a service or area of another store, or a disabled one, creating nothing", async () => {
    const before = await orderCount();
    const refused = [
      dropOff(main, { serviceLines: [{ serviceId: other.shirt, amount: "1" }] }),
      dropOff(main, { serviceLines: [{ serviceId: main.disabled, amount: "1" }] }),
      pickup({ areaId: other.fixedArea }),
      pickup({ areaId: main.disabledArea }),
    ];
    const results = await Promise.all(refused.map((booking) => createBooking(main.slug, booking)));

    expect(results.map((result) => !result.ok && [result.code, result.step])).toEqual([
      ["SERVICE_UNAVAILABLE", "services"],
      ["SERVICE_UNAVAILABLE", "services"],
      ["AREA_UNAVAILABLE", "pickup"],
      ["AREA_UNAVAILABLE", "pickup"],
    ]);
    expect(await orderCount()).toBe(before);
  });
});

describe("the customer's note", () => {
  it("saves the note trimmed, shows it on the staff order detail, and never changes the total", async () => {
    const note = "  2 curtains, 1 rug\nplease iron the shirts only <b>thanks</b>  ";
    const [withNote, without] = await Promise.all([book(dropOff(main, { customerNote: note })), book(dropOff())]);

    expect(withNote.customerNote).toBe("2 curtains, 1 rug\nplease iron the shirts only <b>thanks</b>");
    // The same lines, the same total, and still approved at once: nothing is priced from the note.
    expect(withNote.lines).toEqual([expect.objectContaining({ description: "Shirt", lineTotal: 240_000 })]);
    expect(withNote.quoteRevisions[0]).toMatchObject({ status: "APPROVED", total: without.quoteRevisions[0].total });
    expect(withNote.quoteRevisions[0].total).toBe(240_000);

    const detail = await getOrderDetail(main.id, withNote.id, "STAFF");
    expect(detail?.order.customerNote).toBe(withNote.customerNote);
    expect(detail?.order.approvedQuote?.total).toBe(240_000);
  });

  it("keeps a quote-required booking's estimate as it was", async () => {
    const lines = [{ serviceId: main.bedding, amount: "3" }];
    const [withNote, without] = await Promise.all([
      book(dropOff(main, { serviceLines: lines, customerNote: "Also 3 duvets" })),
      book(dropOff(main, { serviceLines: lines })),
    ]);
    expect(withNote.customerNote).toBe("Also 3 duvets");
    expect(withNote.quoteRevisions[0]).toMatchObject({ status: "PENDING", total: without.quoteRevisions[0].total });
  });

  it("stores an empty, whitespace-only, or missing note as NULL", async () => {
    const orders = await Promise.all([
      book(dropOff(main, { customerNote: "" })),
      book(dropOff(main, { customerNote: "  \n\t  " })),
      book(dropOff()),
    ]);
    expect(orders.map((order) => order.customerNote)).toEqual([null, null, null]);
  });

  it("refuses a fractional, missing, or out-of-range amount sent directly, creating nothing", async () => {
    const before = await orderCount();
    for (const [amount, message] of [
      ["1.5", "Enter a whole number, like 3"],
      ["2.0", "Enter a whole number, like 3"],
      ["", "Enter how many"],
      ["0", "Enter at least 1"],
      ["1000", "Enter 999 or fewer"],
    ]) {
      // On a fixed-price and a quote-required service alike.
      for (const serviceId of [main.shirt, main.bedding]) {
        const result = await createBooking(main.slug, dropOff(main, { serviceLines: [{ serviceId, amount }] }));
        if (result.ok) throw new Error(`Expected "${amount}" to be refused`);
        // Under serviceLines.0.amount (the form check) or .quantity (the range check).
        expect(Object.entries(result.fieldErrors ?? {})).toEqual([[expect.stringMatching(/^serviceLines\.0\./), message]]);
      }
    }
    expect(await orderCount()).toBe(before);
  });

  it("accepts 300 characters and refuses 301, creating nothing", async () => {
    const accepted = await book(dropOff(main, { customerNote: "a".repeat(300) }));
    expect(accepted.customerNote).toHaveLength(300);

    const before = await orderCount();
    const result = await createBooking(main.slug, dropOff(main, { customerNote: "a".repeat(301) }));
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      step: "services",
      fieldErrors: { customerNote: "Note must be 300 characters or fewer" },
    });
    expect(await orderCount()).toBe(before);
  });

  it("is limited to 300 characters by the database too", async () => {
    const order = await book(dropOff());
    await expect(
      prisma.order.update({ where: { id: order.id }, data: { customerNote: "a".repeat(301) } }),
    ).rejects.toThrow(/Order_customerNote_length_check/);
  });
});

describe("re-checking the pickup time", () => {
  it("refuses a window that is now less than 2 hours away, creating nothing", async () => {
    vi.setSystemTime(new Date("2099-06-15T08:01:00.000Z")); // 9:01 AM in Lagos
    const before = await orderCount();
    const result = await createBooking(main.slug, pickup({ windowStart: "10:00", windowEnd: "12:00" }));

    expect(result).toMatchObject({
      ok: false,
      code: "PICKUP_NOT_AVAILABLE",
      step: "pickup",
      message: "That pickup time is no longer available. Please choose another.",
    });
    expect(await orderCount()).toBe(before);
  });

  it("refuses a date closed while the form was open, creating nothing", async () => {
    const date = new Date(`${WEDNESDAY}T00:00:00.000Z`);
    await prisma.closedDate.create({ data: { storeId: main.id, date, note: "Closed today" } });
    try {
      const before = await orderCount();
      const result = await createBooking(main.slug, pickup({ date: WEDNESDAY }));
      expect(result).toMatchObject({ ok: false, code: "PICKUP_NOT_AVAILABLE", step: "pickup" });
      expect(await orderCount()).toBe(before);
    } finally {
      await prisma.closedDate.delete({ where: { storeId_date: { storeId: main.id, date } } });
    }
  });

  it("refuses a made-up window, an inactive or closed day, and a date beyond 14 days", async () => {
    const before = await orderCount();
    const results = await Promise.all(
      [
        pickup({ windowStart: "09:00", windowEnd: "11:00" }),
        pickup({ windowStart: "10:00", windowEnd: "13:00" }),
        pickup({ date: CLOSED_TUESDAY }),
        pickup({ date: "2099-06-20" }), // Saturday
        pickup({ date: "2099-06-30" }), // 15 days after today
      ].map((booking) => createBooking(main.slug, booking)),
    );

    expect(results.map((result) => !result.ok && result.code)).toEqual(Array(5).fill("PICKUP_NOT_AVAILABLE"));
    expect(await orderCount()).toBe(before);
  });

  it("accepts the last of the 15 dates", async () => {
    const order = await book(pickup({ date: "2099-06-29" })); // Monday, 14 days after today
    expect(order.requestedPickupDate).toEqual(new Date("2099-06-29T00:00:00.000Z"));
  });

  it("refuses a pickup sent after the owner switched pickup off, creating nothing", async () => {
    await prisma.store.update({ where: { id: main.id }, data: { pickupDeliveryEnabled: false } });
    try {
      const before = await orderCount();
      const result = await createBooking(main.slug, pickup());
      expect(result).toMatchObject({ ok: false, code: "FULFILMENT_NOT_OFFERED", step: "fulfilment" });
      expect(await orderCount()).toBe(before);
    } finally {
      await prisma.store.update({ where: { id: main.id }, data: { pickupDeliveryEnabled: true } });
    }
  });
});

describe("customers", () => {
  it("keeps an existing customer's name and email, and fills in an empty email", async () => {
    const phone = newPhone();
    await prisma.customer.create({ data: { storeId: main.id, name: "Chidi Okeke", phone, email: "chidi@example.com" } });
    const kept = await book(dropOff(main, { customer: { name: "Someone Else", phone, email: "other@example.com" } }));
    expect(kept.customer).toMatchObject({ name: "Chidi Okeke", phone, email: "chidi@example.com" });

    const noEmail = newPhone();
    await prisma.customer.create({ data: { storeId: main.id, name: "Ngozi Eze", phone: noEmail, email: null } });
    const filled = await book(dropOff(main, { customer: { name: "Not Ngozi", phone: noEmail, email: "Ngozi@Example.com" } }));
    expect(filled.customer).toMatchObject({ name: "Ngozi Eze", email: "ngozi@example.com" });
  });

  it("creates a new customer from the booking", async () => {
    const phone = newPhone();
    const order = await book(dropOff(main, { customer: { name: "  Bisi Ade ", phone: phone.replace("+234", "0"), email: "" } }));
    expect(order.customer).toMatchObject({ name: "Bisi Ade", phone, email: null });
  });
});

describe("repeated submissions", () => {
  it("returns the same order for the same request ID", async () => {
    const booking = dropOff();
    const first = await createBooking(main.slug, booking);
    const again = await createBooking(main.slug, booking);
    const [a, b] = await Promise.all([createBooking(main.slug, booking), createBooking(main.slug, booking)]);

    expect(first.ok && first.displayNumber).toBeTruthy();
    const displayNumber = first.ok ? first.displayNumber : null;
    for (const result of [again, a, b]) expect(result).toMatchObject({ ok: true, displayNumber });
    expect(await prisma.order.count({ where: { storeId: main.id, clientRequestId: booking.clientRequestId } })).toBe(1);
    // Repeats of the same booking never notify staff again.
    expect(await prisma.notification.count({ where: { storeId: main.id, type: "ONLINE_BOOKING", order: { clientRequestId: booking.clientRequestId } } })).toBe(1);

    // Each response carries a fresh link (the first was never seen), and only
    // the one stored last opens the order.
    const { trackingTokenHash } = await prisma.order.findFirstOrThrow({
      where: { storeId: main.id, clientRequestId: booking.clientRequestId },
      select: { trackingTokenHash: true },
    });
    const hashes = [first, again, a, b].map((result) => (result.ok && result.trackingUrl ? hashToken(tokenOf(result.trackingUrl)) : null));
    expect(hashes.every((hash) => hash !== null)).toBe(true);
    expect(hashes.filter((hash) => hash === trackingTokenHash)).toHaveLength(1);
    expect(hashes[0]).not.toBe(trackingTokenHash);
  });
});

describe("tracking link", () => {
  it("shows a link that opens the new order, storing only the token's hash", async () => {
    const result = await createBooking(main.slug, dropOff());
    if (!result.ok || !result.trackingUrl) throw new Error("The booking should succeed with a link");
    const url = new URL(result.trackingUrl);
    expect(url.pathname).toMatch(/^\/o\/[A-Za-z0-9_-]{43}$/);

    const token = tokenOf(result.trackingUrl);
    const order = await prisma.order.findFirstOrThrow({
      where: { trackingTokenHash: hashToken(token) },
      select: { orderNumber: true, trackingTokenHash: true, store: { select: { orderPrefix: true } } },
    });
    expect(`${order.store.orderPrefix}-${order.orderNumber}`).toBe(result.displayNumber);
    expect(order.trackingTokenHash).not.toContain(token);
    expect(await prisma.order.count({ where: { trackingTokenHash: token } })).toBe(0);
  });
});

function tokenOf(trackingUrl: string): string {
  return new URL(trackingUrl).pathname.split("/").at(-1) ?? "";
}

describe("booking limits", () => {
  it("refuses the 6th booking from one phone at one store in 24 hours, creating nothing", async () => {
    const phone = newPhone();
    // Four earlier bookings from this phone (from other connections), then the 5th and 6th.
    await insertPastBookings(main, 4, { phone, ipHash: hashClientIp(newIp()) });
    const [fifthBooking, sixthBooking] = Array.from({ length: 2 }, () =>
      dropOff(main, { customer: { name: "Ada Obi", phone, email: "" } }),
    );
    await book(fifthBooking);
    const before = await orderCount();
    const sixth = await createBooking(main.slug, sixthBooking);

    expect(sixth).toEqual({
      ok: false,
      code: "BOOKING_LIMIT_REACHED",
      message: "Too many bookings from this number or connection. Please try again later or contact the store.",
      step: undefined,
      fieldErrors: {},
    });
    expect(await orderCount()).toBe(before);

    // Resubmitting the 5th booking returns its order instead of being refused.
    const fifth = await createBooking(main.slug, fifthBooking);
    expect(fifth.ok).toBe(true);
    expect(await orderCount()).toBe(before);

    // The same phone at another store, and 24 hours later, are not limited.
    expect((await createBooking(other.slug, dropOff(other, { customer: { name: "Ada Obi", phone, email: "" } }))).ok).toBe(true);
    vi.setSystemTime(new Date(MONDAY_7AM.getTime() + 24 * 60 * 60 * 1000 + 1000));
    expect((await createBooking(main.slug, dropOff(main, { customer: { name: "Ada Obi", phone, email: "" } }))).ok).toBe(true);
  });

  it("refuses the 21st booking from one IP in an hour across stores, creating nothing", async () => {
    // 19 earlier bookings from this IP across both stores, then the 20th.
    await insertPastBookings(main, 10, { phone: newPhone(), ipHash: currentIpHash() });
    await insertPastBookings(other, 9, { phone: newPhone(), ipHash: currentIpHash() });
    await book(dropOff(other), other);
    const before = (await orderCount(main)) + (await orderCount(other));
    const refused = await Promise.all([createBooking(main.slug, dropOff(main)), createBooking(other.slug, dropOff(other))]);

    expect(refused.map((result) => !result.ok && result.code)).toEqual(["BOOKING_LIMIT_REACHED", "BOOKING_LIMIT_REACHED"]);
    expect((await orderCount(main)) + (await orderCount(other))).toBe(before);

    // An hour later the IP may book again.
    vi.setSystemTime(new Date(MONDAY_7AM.getTime() + 60 * 60 * 1000 + 1000));
    expect((await createBooking(main.slug, dropOff(main))).ok).toBe(true);
  });

  it("creates exactly 5 orders from 10 simultaneous bookings from one phone at one store", async () => {
    const phone = newPhone();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createBooking(main.slug, dropOff(main, { customer: { name: "Ada Obi", phone, email: "" } }))),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(5);
    expect(results.filter((result) => !result.ok && result.code === "BOOKING_LIMIT_REACHED")).toHaveLength(5);
    expect(await prisma.order.count({ where: { storeId: main.id, customer: { phone } } })).toBe(5);
    // Refused bookings leave no notification.
    expect(await prisma.notification.count({ where: { storeId: main.id, order: { customer: { phone } } } })).toBe(5);
  }, 180_000);

  it("clears the IP hash on that store's orders older than 24 hours", async () => {
    const yesterday = new Date(MONDAY_7AM.getTime() - 25 * 60 * 60 * 1000);
    vi.setSystemTime(yesterday);
    const old = await book(dropOff());
    const otherStoreOld = await book(dropOff(other), other);
    expect(old.bookingIpHash).not.toBeNull();

    vi.setSystemTime(MONDAY_7AM);
    const recent = await book(dropOff());

    expect((await findOrder(main, old.clientRequestId ?? "")).bookingIpHash).toBeNull();
    expect(recent.bookingIpHash).not.toBeNull();
    // Another store's orders are left for its own bookings (or Feature 15's sweep).
    expect((await findOrder(other, otherStoreOld.clientRequestId ?? "")).bookingIpHash).not.toBeNull();
  });
});

describe("whether a store takes bookings", () => {
  it("shows a store that isn't accepting new orders, and refuses its bookings", async () => {
    // An unpaid invoice past its due date and grace period: Suspended.
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { storeId: other.id } });
    const invoice = await prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: subscription.id,
        amount: 1000,
        periodStart: new Date("2099-04-01T00:00:00.000Z"),
        periodEnd: new Date("2099-04-30T00:00:00.000Z"),
        dueDate: new Date("2099-05-01T00:00:00.000Z"),
      },
    });
    try {
      const page = await loadBookingPage(other.slug, new Date());
      expect(page?.availability).toBe("NOT_ACCEPTING");
      expect(page?.options.services.map((service) => service.name)).toContain("Shirt");

      const before = await orderCount(other);
      expect(await createBooking(other.slug, dropOff(other))).toMatchObject({ ok: false, code: "NOT_ACCEPTING" });
      expect(await orderCount(other)).toBe(before);
    } finally {
      await prisma.subscriptionInvoice.delete({ where: { id: invoice.id } });
    }
  });

  it("treats a Deactivated store like an unknown one", async () => {
    await prisma.store.update({ where: { id: other.id }, data: { status: "DEACTIVATED" } });
    try {
      expect(await loadBookingPage(other.slug, new Date())).toBeNull();
      expect(await createBooking(other.slug, dropOff(other))).toMatchObject({ ok: false, code: "STORE_UNAVAILABLE" });
    } finally {
      await prisma.store.update({ where: { id: other.id }, data: { status: "ACTIVE" } });
    }
    expect(await loadBookingPage("no-such-store-anywhere", new Date())).toBeNull();
  });

  it("doesn't offer pickup when isPickupAvailable is false", async () => {
    await prisma.serviceArea.updateMany({ where: { storeId: other.id }, data: { isActive: false } });
    try {
      const page = await loadBookingPage(other.slug, new Date());
      expect(page?.availability).toBe("OPEN");
      expect(page?.options).toMatchObject({ dropOff: true, pickup: false, areas: [], dates: [] });
    } finally {
      await prisma.serviceArea.updateMany({ where: { storeId: other.id, name: { not: "Old area" } }, data: { isActive: true } });
    }
  });

  it("offers today's windows at least 2 hours away, and no closed or inactive dates", async () => {
    const page = await loadBookingPage(main.slug, new Date());
    const dates = page?.options.dates ?? [];

    expect(dates[0]).toEqual({
      date: MONDAY,
      windows: [
        { start: "10:00", end: "12:00" },
        { start: "12:00", end: "14:00" },
        { start: "14:00", end: "16:00" },
        { start: "16:00", end: "17:00" },
      ],
    });
    expect(dates.map((option) => option.date)).not.toContain(CLOSED_TUESDAY);
    expect(dates.map((option) => option.date)).not.toContain("2099-06-20");
    expect(dates.at(-1)?.date).toBe("2099-06-29");
  });

  it("shows the no-online-booking state, and refuses bookings, without active services", async () => {
    await prisma.service.updateMany({ where: { storeId: other.id }, data: { isActive: false } });
    try {
      expect((await loadBookingPage(other.slug, new Date()))?.availability).toBe("NO_ONLINE_BOOKING");
      expect(await createBooking(other.slug, dropOff(other))).toMatchObject({ ok: false, code: "NO_ONLINE_BOOKING" });
    } finally {
      await prisma.service.updateMany({ where: { storeId: other.id, name: { not: "Old service" } }, data: { isActive: true } });
    }
  });

  it("shows the no-online-booking state with drop-off off and pickup unavailable", async () => {
    // A store always has one option on (Store_fulfilment_option_check): pickup
    // stays on, but with no active area it can't be booked.
    await prisma.store.update({ where: { id: other.id }, data: { dropOffEnabled: false } });
    await prisma.serviceArea.updateMany({ where: { storeId: other.id }, data: { isActive: false } });
    try {
      expect((await loadBookingPage(other.slug, new Date()))?.availability).toBe("NO_ONLINE_BOOKING");
      expect(await createBooking(other.slug, dropOff(other))).toMatchObject({ ok: false, code: "NO_ONLINE_BOOKING" });
    } finally {
      await prisma.serviceArea.updateMany({ where: { storeId: other.id, name: { not: "Old area" } }, data: { isActive: true } });
      await prisma.store.update({ where: { id: other.id }, data: { dropOffEnabled: true } });
    }
  });
});
