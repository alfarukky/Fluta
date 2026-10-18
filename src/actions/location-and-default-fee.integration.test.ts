import { randomUUID } from "node:crypto";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TrackingOrder } from "@/components/tracking/TrackingOrder";
import { getTrackingMetadata } from "@/components/tracking/tracking-page";
import type { PrismaClient } from "@/generated/prisma/client";
import { CLIENT_IP_HEADER } from "@/lib/client-ip";
import { toMatchKey } from "@/lib/match-key";
import { UNLISTED_AREA_ID, type BookingRequest } from "@/schemas/booking";
import { DEFAULT_ORDER_LIST_FILTERS } from "@/schemas/orders";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";
import { loadBookingPage } from "@/server/services/booking";
import { getDeliveries } from "@/server/services/deliveries";
import { runMessageJob } from "@/server/services/notifications";
import { loadOrderEntry } from "@/server/services/order-entry";
import { getOrderDetail, getOrderListPage } from "@/server/services/orders";
import { loadTrackingPage } from "@/server/services/tracking";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { fakeMailer, fakeSms } from "@/test/integration/fakes";

import { createBooking } from "./booking";
import { saveDefaultDeliveryFee } from "./fulfilment";
import { openWhatsApp } from "./messages";

// Feature 15b: a customer's shared location (only for "Open in Maps", never
// shown to customers or written anywhere else), and the store's default fee
// for areas not in its list.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Each booking makes several Neon round trips (slow from here).
vi.setConfig({ testTimeout: 120_000 });

const EMAIL_DOMAIN = "location-test.example";
const PASSWORD = "test-password-1234";
const DAY = 24 * 60 * 60 * 1000;
// Distinctive enough that finding these digits anywhere means a leak.
const LOCATION = { latitude: 9.081234, longitude: 7.491234 };
const LEAK_PATTERNS = ["9.081234", "7.491234", "9.08123", "7.49123", "atitude", "ongitude"];

let prisma: PrismaClient;
let store: TestStore;
let owner: { id: string; headers: Headers };

interface TestStore {
  id: string;
  slug: string;
  orderPrefix: string;
  timeZone: string;
  shirt: string;
  area: string;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  store = await createStore();
  owner = await addOwner();
}, 180_000);

beforeEach(async () => {
  fakeSms.reset();
  fakeMailer.reset();
  request.headers = new Headers({ [CLIENT_IP_HEADER]: newIp() });
  await setStore({ defaultDeliveryFee: null });
  await prisma.serviceArea.updateMany({ where: { storeId: store.id }, data: { isActive: true } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
      prisma.orderLine.deleteMany({ where }),
      prisma.order.deleteMany({ where }),
      prisma.customer.deleteMany({ where }),
      prisma.service.deleteMany({ where }),
      prisma.serviceArea.deleteMany({ where }),
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
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 180_000);

// Pickup every day, 6:00 AM to 10:00 PM, with one fixed-charge area.
async function createStore(): Promise<TestStore> {
  const slug = `pin-test-${randomUUID().slice(0, 8)}`;
  const { id, orderPrefix, timeZone } = await prisma.store.create({
    data: {
      name: "Pin Test Laundry",
      slug,
      orderPrefix: "LT",
      dropOffEnabled: true,
      pickupDeliveryEnabled: true,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      openTime: "06:00",
      closeTime: "22:00",
      subscription: { create: { planName: "Test", priceAmount: 0 } },
    },
    select: { id: true, orderPrefix: true, timeZone: true },
  });
  const [shirt, area] = await Promise.all([
    prisma.service.create({
      data: { storeId: id, name: "Shirt", nameKey: toMatchKey("Shirt"), pricingType: "PER_ITEM", price: 80_000 },
      select: { id: true },
    }),
    prisma.serviceArea.create({
      data: { storeId: id, name: "Wuse 2", nameKey: toMatchKey("Wuse 2"), chargeType: "FIXED", fixedCharge: 150_000 },
      select: { id: true },
    }),
  ]);
  return { id, slug, orderPrefix, timeZone, shirt: shirt.id, area: area.id };
}

async function addOwner() {
  const email = `owner-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const { id } = await createUserWithPassword({ name: "Test owner", email, password: PASSWORD }, prisma);
  const result = await createMembership(store.id, { userId: id, role: "OWNER" }, prisma);
  if (!result.success) throw new Error(`Couldn't add ${email}`);
  return { id, headers: await signInHeaders(email, PASSWORD) };
}

async function setStore(data: { defaultDeliveryFee: number | null }) {
  await prisma.store.update({ where: { id: store.id }, data });
}

function newPhone(): string {
  return `+234803${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

function newIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

// The first pickup date and window the booking page offers right now.
async function firstWindow() {
  const page = await loadBookingPage(store.slug, new Date());
  const date = page?.options.dates[0];
  if (!date) throw new Error("No pickup date offered");
  return { date: date.date, windowStart: date.windows[0].start, windowEnd: date.windows[0].end };
}

// Pickup details are typed loosely here so tests can send what a tampered
// request would (not-a-number, strings, out-of-range values).
async function pickupBooking(details: Record<string, unknown> = {}, email = ""): Promise<BookingRequest> {
  return {
    clientRequestId: randomUUID(),
    serviceLines: [{ serviceId: store.shirt, amount: "2" }],
    fulfilmentType: "PICKUP_DELIVERY",
    pickup: { areaId: store.area, address: "12 Test Street, Wuse 2, near the market", ...(await firstWindow()), ...details },
    customer: { name: "Ada Obi", phone: newPhone(), email },
  } as BookingRequest;
}

async function book(booking: BookingRequest) {
  const result = await createBooking(store.slug, booking);
  if (!result.ok) throw new Error(`Booking refused: ${result.code}`);
  const order = await prisma.order.findUniqueOrThrow({
    where: { storeId_clientRequestId: { storeId: store.id, clientRequestId: booking.clientRequestId } },
    include: { quoteRevisions: true },
  });
  return { order, trackingUrl: result.trackingUrl };
}

function expectNoLeak(text: string) {
  for (const pattern of LEAK_PATTERNS) expect(text).not.toContain(pattern);
}

describe("a customer's shared location", () => {
  it("is saved with a booking, rounded to 6 decimal places", async () => {
    const { order } = await book(await pickupBooking({ location: { latitude: 9.0812344, longitude: 7.4912336 } }));
    expect(order.pickupLatitude?.toString()).toBe("9.081234");
    expect(order.pickupLongitude?.toString()).toBe("7.491234");
    expect(order.addressText).toBe("12 Test Street, Wuse 2, near the market");
  });

  it("is optional: a booking without one works normally", async () => {
    const { order } = await book(await pickupBooking());
    expect(order).toMatchObject({ pickupLatitude: null, pickupLongitude: null, serviceAreaId: store.area });
  });

  it("is ignored when out of range or not real numbers, and never blocks the booking", async () => {
    const tampered = [
      { latitude: 91, longitude: 7.49 },
      { latitude: 9.08, longitude: -180.5 },
      { latitude: Number.NaN, longitude: 7.49 },
      { latitude: 9.08, longitude: Number.POSITIVE_INFINITY },
      { latitude: "9.08", longitude: "7.49" },
      { latitude: 9.08 },
      "9.08,7.49",
    ];
    for (const location of tampered) {
      request.headers = new Headers({ [CLIENT_IP_HEADER]: newIp() });
      const { order } = await book(await pickupBooking({ location }));
      expect(order).toMatchObject({ pickupLatitude: null, pickupLongitude: null });
    }
  });

  it("is never sent to customers: not in messages, message records, the tracking page, its preview, or logs", async () => {
    const logged = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log"), vi.spyOn(console, "info")];
    const email = `customer-${randomUUID().slice(0, 8)}@example.com`;
    const { order, trackingUrl } = await book(await pickupBooking({ location: LOCATION }, email));
    expect(order.pickupLatitude?.toString()).toBe(String(LOCATION.latitude));

    // The booking's SMS and its email copy.
    expect(fakeSms.sent.length).toBeGreaterThan(0);
    expect(fakeMailer.sent.length).toBeGreaterThan(0);
    expectNoLeak(JSON.stringify(fakeSms.sent));
    expectNoLeak(JSON.stringify(fakeMailer.sent));

    // The tracking page's data, its markup, and its link preview.
    const token = trackingUrl?.split("/o/")[1] ?? "";
    const page = await loadTrackingPage(token);
    expect(page.kind).toBe("VALID");
    expectNoLeak(JSON.stringify(page));
    expect(JSON.stringify(page)).not.toMatch(/location/i);
    if (page.kind === "VALID") {
      const markup = renderToStaticMarkup(createElement(TrackingOrder, { view: page.view, basePath: `/o/${token}` }));
      expectNoLeak(markup);
      expect(markup).not.toMatch(/location|maps/i);
    }
    expectNoLeak(JSON.stringify(await getTrackingMetadata(token)));

    // WhatsApp text, opened by the store's owner (this issues a new link, so
    // it comes after the tracking page checks).
    request.headers = owner.headers;
    const whatsapp = await openWhatsApp({ orderId: order.id, withLink: true });
    expect(whatsapp.ok).toBe(true);
    expectNoLeak(decodeURIComponent(JSON.stringify(whatsapp)));

    // Every message record for the order, the WhatsApp one included.
    const records = await prisma.messageEvent.findMany({ where: { storeId: store.id, orderId: order.id } });
    expect(records.length).toBeGreaterThan(1);
    expectNoLeak(JSON.stringify(records));

    for (const spy of logged) expectNoLeak(JSON.stringify(spy.mock.calls));
  });

  it("is given to the store's own members for Open in Maps, on the order and the Deliveries view", async () => {
    const { order } = await book(await pickupBooking({ location: LOCATION }));
    const detail = await getOrderDetail(store.id, order.id, "STAFF");
    expect(detail?.location).toEqual(LOCATION);

    await prisma.order.update({ where: { id: order.id }, data: { stage: "READY" } });
    const deliveries = await getDeliveries(store, new Date());
    expect(deliveries.readyToDeliver.find((card) => card.orderId === order.id)?.location).toEqual(LOCATION);
  });

  it("is cleared by the scheduled job 30 days after the order is closed, keeping the typed address", async () => {
    const now = new Date();
    const orders = await Promise.all(
      Array.from({ length: 4 }, async () => {
        request.headers = new Headers({ [CLIENT_IP_HEADER]: newIp() });
        return (await book(await pickupBooking({ location: LOCATION }))).order;
      }),
    );
    const [oldCompleted, oldCancelled, recentCompleted, open] = orders;
    await prisma.order.update({ where: { id: oldCompleted.id }, data: { stage: "COMPLETED", completedAt: new Date(now.getTime() - 31 * DAY) } });
    await prisma.order.update({ where: { id: oldCancelled.id }, data: { stage: "CANCELLED", cancelledAt: new Date(now.getTime() - 31 * DAY) } });
    await prisma.order.update({ where: { id: recentCompleted.id }, data: { stage: "COMPLETED", completedAt: new Date(now.getTime() - 29 * DAY) } });

    const result = await runMessageJob(now);
    expect(result.locationsCleared).toBeGreaterThanOrEqual(2);

    const after = await prisma.order.findMany({
      where: { id: { in: orders.map((order) => order.id) } },
      select: { id: true, pickupLatitude: true, pickupLongitude: true, addressText: true },
    });
    const byId = new Map(after.map((order) => [order.id, order]));
    for (const cleared of [oldCompleted, oldCancelled]) {
      expect(byId.get(cleared.id)).toMatchObject({
        pickupLatitude: null,
        pickupLongitude: null,
        addressText: "12 Test Street, Wuse 2, near the market",
      });
    }
    for (const kept of [recentCompleted, open]) expect(byId.get(kept.id)?.pickupLatitude?.toString()).toBe("9.081234");
    // Reopened after clearing: no Open in Maps, only the address.
    expect((await getOrderDetail(store.id, oldCompleted.id, "STAFF"))?.location).toBeNull();
  });
});

describe("the default delivery fee", () => {
  it("offers My area isn't listed at ₦0 (Free) and makes pickup available with no areas", async () => {
    await prisma.serviceArea.updateMany({ where: { storeId: store.id }, data: { isActive: false } });
    expect((await loadBookingPage(store.slug, new Date()))?.options.pickup).toBe(false);

    await setStore({ defaultDeliveryFee: 0 });
    const page = await loadBookingPage(store.slug, new Date());
    expect(page?.options).toMatchObject({ pickup: true, areas: [], defaultFee: 0 });
  });

  it("lets a store with a default fee and no areas take pickup bookings", async () => {
    await prisma.serviceArea.updateMany({ where: { storeId: store.id }, data: { isActive: false } });
    await setStore({ defaultDeliveryFee: 250_000 });
    const { order } = await book(await pickupBooking({ areaId: UNLISTED_AREA_ID, areaName: "Gwarinpa" }));
    expect(order).toMatchObject({ isOutOfArea: true, fulfilmentCharge: 250_000 });
  });

  it("creates an out-of-area order with the typed name and the fee copied, fully priced", async () => {
    await setStore({ defaultDeliveryFee: 200_000 });
    const { order } = await book(await pickupBooking({ areaId: UNLISTED_AREA_ID, areaName: "  Kubwa  " }));
    expect(order).toMatchObject({
      isOutOfArea: true,
      serviceAreaId: null,
      serviceAreaName: "Kubwa",
      fulfilmentCharge: 200_000,
    });
    // Fully priced: version 1 is approved by the customer at once.
    const [v1] = order.quoteRevisions;
    expect(v1).toMatchObject({ status: "APPROVED", fulfilmentCharge: 200_000, total: 160_000 + 200_000 });
    expect(order.approvedQuoteId).toBe(v1.id);
  });

  it("isn't offered without a default fee, and such a request is refused", async () => {
    expect((await loadBookingPage(store.slug, new Date()))?.options.defaultFee).toBeNull();
    const booking = await pickupBooking({ areaId: UNLISTED_AREA_ID, areaName: "Kubwa" });
    expect(await createBooking(store.slug, booking)).toMatchObject({ ok: false, code: "AREA_UNAVAILABLE", step: "pickup" });
    expect(await prisma.order.count({ where: { storeId: store.id, clientRequestId: booking.clientRequestId } })).toBe(0);
  });

  it("needs the area's name for My area isn't listed", async () => {
    await setStore({ defaultDeliveryFee: 200_000 });
    const result = await createBooking(store.slug, await pickupBooking({ areaId: UNLISTED_AREA_ID, areaName: "K" }));
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", fieldErrors: { "pickup.areaName": expect.any(String) } });
  });

  it("catches a default fee removed while the form was open", async () => {
    await setStore({ defaultDeliveryFee: 200_000 });
    expect((await loadBookingPage(store.slug, new Date()))?.options.defaultFee).toBe(200_000);
    const booking = await pickupBooking({ areaId: UNLISTED_AREA_ID, areaName: "Kubwa" });
    await setStore({ defaultDeliveryFee: null });
    expect(await createBooking(store.slug, booking)).toMatchObject({ ok: false, code: "AREA_UNAVAILABLE" });
  });

  it("charges the fee as it is at submission", async () => {
    await setStore({ defaultDeliveryFee: 200_000 });
    const booking = await pickupBooking({ areaId: UNLISTED_AREA_ID, areaName: "Kubwa" });
    await setStore({ defaultDeliveryFee: 300_000 });
    expect((await book(booking)).order.fulfilmentCharge).toBe(300_000);
  });

  it("is saved by the owner (₦0 as Free, empty as none), and changing it leaves existing orders unchanged", async () => {
    await setStore({ defaultDeliveryFee: 200_000 });
    const { order } = await book(await pickupBooking({ areaId: UNLISTED_AREA_ID, areaName: "Kubwa" }));

    request.headers = owner.headers;
    const save = (value: string) => {
      const formData = new FormData();
      formData.set("defaultDeliveryFee", value);
      return saveDefaultDeliveryFee(formData);
    };
    expect(await save("0")).toMatchObject({ ok: true, fee: { defaultDeliveryFee: 0 }, pickupAvailable: true });
    expect(await save("₦1,500")).toMatchObject({ ok: true, fee: { defaultDeliveryFee: 150_000 } });
    expect(await save("1000001")).toMatchObject({ ok: false, fieldErrors: { defaultDeliveryFee: expect.any(String) } });
    expect(await save("abc")).toMatchObject({ ok: false, fieldErrors: { defaultDeliveryFee: expect.any(String) } });
    expect(await save("  ")).toMatchObject({ ok: true, fee: { defaultDeliveryFee: null } });

    const unchanged = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { quoteRevisions: true },
    });
    expect(unchanged.fulfilmentCharge).toBe(200_000);
    expect(unchanged.quoteRevisions[0].fulfilmentCharge).toBe(200_000);
  });

  it("refuses anyone who isn't signed in as the owner", async () => {
    request.headers = new Headers();
    const formData = new FormData();
    formData.set("defaultDeliveryFee", "0");
    await expect(saveDefaultDeliveryFee(formData)).rejects.toThrow();
    expect((await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).defaultDeliveryFee).toBeNull();
  });

  it("is given to staff order entry, to pre-fill out-of-area charges", async () => {
    await setStore({ defaultDeliveryFee: 175_000 });
    const entry = await loadOrderEntry(store.id, store.timeZone, new Date());
    expect(entry.settings.defaultDeliveryFee).toBe(175_000);
  });

  it("marks out-of-area orders in the orders list, on the order, and on Deliveries cards", async () => {
    await setStore({ defaultDeliveryFee: 200_000 });
    const { order } = await book(await pickupBooking({ areaId: UNLISTED_AREA_ID, areaName: "Kubwa" }));
    const listed = await book(await pickupBooking());

    const list = await getOrderListPage(store, DEFAULT_ORDER_LIST_FILTERS, new Date());
    expect(list.rows.find((row) => row.id === order.id)?.isOutOfArea).toBe(true);
    expect(list.rows.find((row) => row.id === listed.order.id)?.isOutOfArea).toBe(false);

    expect((await getOrderDetail(store.id, order.id, "STAFF"))?.order.isOutOfArea).toBe(true);

    await prisma.order.update({ where: { id: order.id }, data: { stage: "READY" } });
    const deliveries = await getDeliveries(store, new Date());
    expect(deliveries.readyToDeliver.find((card) => card.orderId === order.id)).toMatchObject({
      isOutOfArea: true,
      areaName: "Kubwa",
    });
  });
});
