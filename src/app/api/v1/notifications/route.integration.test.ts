import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { createBooking } from "@/actions/booking";
import { CLIENT_IP_HEADER } from "@/lib/client-ip";
import { getServerEnv } from "@/lib/env";
import { toMatchKey } from "@/lib/match-key";
import type { BookingRequest } from "@/schemas/booking";
import { getPrisma } from "@/server/data/client";
import { addStaffNotification } from "@/server/data/staff-notifications";
import { clearOldNotifications } from "@/server/services/staff-notifications";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { createTestUser, deleteTestPeople, TEST_USER_PASSWORD } from "@/test/integration/users";
import type { OpenedNotificationsResponse, UnreadCountResponse } from "@/types/staff-notifications";

import { GET } from "./route";
import { POST } from "./seen/route";

// The staff bell (Feature 17b): the count and open requests, per person,
// per store, and by role. Each test store is its own, so counts are exact.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

vi.setConfig({ testTimeout: 90_000 });

const DAY = 24 * 60 * 60 * 1000;

interface TestStore {
  id: string;
  slug: string;
  orderPrefix: string;
  shirt: string;
  owner: Headers;
  staff: Headers;
  rider: Headers;
}

let prisma: PrismaClient;
let a: TestStore;
let b: TestStore;

beforeAll(async () => {
  prisma = createTestPrisma();
  [a, b] = await Promise.all([createStore("Bell Test Laundry", "BT"), createStore("Other Bell Laundry", "OB")]);
}, 180_000);

beforeEach(() => {
  request.headers = new Headers({ [CLIENT_IP_HEADER]: newIp() });
});

afterAll(async () => {
  // Test cleanup only: the app never deletes orders or notifications this way.
  for (const each of [a, b]) {
    if (!each) continue;
    const where = { storeId: each.id };
    await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
    await prisma.$transaction(
      [
        prisma.notification.deleteMany({ where }),
        prisma.auditEvent.deleteMany({ where }),
        prisma.messageEvent.deleteMany({ where }),
        prisma.statusEvent.deleteMany({ where }),
        prisma.quoteRevision.deleteMany({ where }),
        prisma.orderLine.deleteMany({ where }),
        prisma.order.deleteMany({ where }),
        prisma.customer.deleteMany({ where }),
        prisma.service.deleteMany({ where }),
      ],
      { maxWait: 15_000, timeout: 30_000 },
    );
  }
  await deleteTestPeople(prisma);
  for (const each of [a, b]) {
    if (!each) continue;
    await prisma.subscription.deleteMany({ where: { storeId: each.id } });
    await prisma.store.delete({ where: { id: each.id } });
  }
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function createStore(name: string, orderPrefix: string): Promise<TestStore> {
  const { id, slug } = await prisma.store.create({
    data: {
      name,
      slug: `bell-test-${randomUUID().slice(0, 8)}`,
      orderPrefix,
      dropOffEnabled: true,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      openTime: "08:00",
      closeTime: "17:00",
      emailCopiesEnabled: false,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
    },
    select: { id: true, slug: true },
  });
  const shirt = await prisma.service.create({
    data: { storeId: id, name: "Shirt", nameKey: toMatchKey("Shirt"), pricingType: "PER_ITEM", price: 80_000 },
    select: { id: true },
  });
  const [owner, staff, rider] = await Promise.all(
    (["OWNER", "STAFF", "RIDER"] as const).map(async (role) => {
      const user = await createTestUser(prisma, `bell-${role.toLowerCase()}`, { storeId: id, role });
      return signInHeaders(user.email, TEST_USER_PASSWORD);
    }),
  );
  return { id, slug, orderPrefix, shirt: shirt.id, owner, staff, rider };
}

function newIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

function newPhone(): string {
  return `+234803${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

// An online booking at `store`; returns the new order's ID.
async function book(store: TestStore, name = "Amina Bello"): Promise<string> {
  request.headers = new Headers({ [CLIENT_IP_HEADER]: newIp() });
  const booking: BookingRequest = {
    clientRequestId: randomUUID(),
    serviceLines: [{ serviceId: store.shirt, amount: "2" }],
    fulfilmentType: "DROP_OFF",
    pickup: null,
    customer: { name, phone: newPhone(), email: "" },
  };
  const result = await createBooking(store.slug, booking);
  if (!result.ok) throw new Error("The booking failed");
  const order = await prisma.order.findFirstOrThrow({
    where: { storeId: store.id, clientRequestId: booking.clientRequestId },
    select: { id: true },
  });
  return order.id;
}

async function count(as: Headers): Promise<{ status: number; count?: number }> {
  const response = await GET(new Request(`${getServerEnv().BETTER_AUTH_URL}/api/v1/notifications`, { headers: as }));
  if (!response.ok) return { status: response.status };
  return { status: response.status, count: ((await response.json()) as UnreadCountResponse).count };
}

async function open(as: Headers, origin = getServerEnv().BETTER_AUTH_URL): Promise<{ status: number; body?: OpenedNotificationsResponse }> {
  const headers = new Headers(as);
  headers.set("origin", origin);
  const response = await POST(new Request(`${getServerEnv().BETTER_AUTH_URL}/api/v1/notifications/seen`, { method: "POST", headers }));
  if (!response.ok) return { status: response.status };
  return { status: response.status, body: (await response.json()) as OpenedNotificationsResponse };
}

// Opens the bell for everyone in a store, so each test starts from zero unread.
async function markAllSeen(store: TestStore) {
  await Promise.all([open(store.owner), open(store.staff)]);
}

describe("unread counts", () => {
  it("are per person: opening the bell clears it for that person only", async () => {
    await markAllSeen(a);
    const orderId = await book(a, "Chidi Okeke");
    expect(await count(a.staff)).toEqual({ status: 200, count: 1 });
    expect(await count(a.owner)).toEqual({ status: 200, count: 1 });

    const opened = await open(a.staff);
    expect(opened.status).toBe(200);
    expect(opened.body?.items[0]).toMatchObject({
      text: "New online booking from Chidi Okeke",
      orderNumber: expect.stringMatching(/^BT-\d+$/),
      href: `/orders/${orderId}`,
      isNew: true,
    });
    // Only the customer's name: never a phone number or address.
    expect(JSON.stringify(opened.body)).not.toMatch(/\+234|803/);

    expect(await count(a.staff)).toEqual({ status: 200, count: 0 });
    expect(await count(a.owner)).toEqual({ status: 200, count: 1 });
    // Opened again, it is no longer new.
    expect((await open(a.staff)).body?.items[0]).toMatchObject({ href: `/orders/${orderId}`, isNew: false });
  });

  it("keeps a notification created just after the bell was opened unread", async () => {
    await markAllSeen(a);
    const opened = await open(a.staff);
    expect(opened.status).toBe(200);
    const orderId = await book(a);

    expect(await count(a.staff)).toEqual({ status: 200, count: 1 });
    expect((await open(a.staff)).body?.items.find((item) => item.href === `/orders/${orderId}`)).toMatchObject({ isNew: true });
  });

  it("shows payments needing review to owners only", async () => {
    await markAllSeen(a);
    const orderId = await book(a);
    await getPrisma().$transaction((tx) =>
      addStaffNotification(tx, { storeId: a.id, orderId, type: "PAYMENT_NEEDS_REVIEW", sourceId: `payment-${randomUUID()}` }),
    );

    expect(await count(a.owner)).toEqual({ status: 200, count: 2 });
    expect(await count(a.staff)).toEqual({ status: 200, count: 1 });
    const ownerTexts = (await open(a.owner)).body?.items.map((item) => item.text) ?? [];
    const staffTexts = (await open(a.staff)).body?.items.map((item) => item.text) ?? [];
    expect(ownerTexts.some((text) => text.includes("needs review"))).toBe(true);
    expect(staffTexts.some((text) => text.includes("needs review"))).toBe(false);
  });

  it("never counts or lists notifications older than 30 days", async () => {
    await prisma.membership.updateMany({ where: { storeId: a.id, role: "STAFF" }, data: { notificationsSeenAt: null } });
    const orderId = await book(a);
    const before = await count(a.staff);
    await prisma.notification.create({
      data: {
        storeId: a.id,
        orderId,
        type: "PRICE_APPROVED",
        sourceId: `old-${randomUUID()}`,
        audience: "STAFF_AND_OWNERS",
        createdAt: new Date(Date.now() - 31 * DAY),
      },
    });
    expect(await count(a.staff)).toEqual(before);
    const items = (await open(a.staff)).body?.items ?? [];
    expect(items.some((item) => item.text.includes("approved"))).toBe(false);
  });
});

describe("who may ask", () => {
  it("refuses riders, people signed out, and posts from another site", async () => {
    expect((await count(a.rider)).status).toBe(403);
    expect((await open(a.rider)).status).toBe(403);
    expect((await count(new Headers())).status).toBe(401);
    expect((await open(new Headers())).status).toBe(401);
    expect((await open(a.staff, "https://evil.example")).status).toBe(403);
  });

  it("refuses a member whose membership was deactivated", async () => {
    const user = await createTestUser(prisma, "bell-leaver", { storeId: a.id, role: "STAFF" });
    const headers = await signInHeaders(user.email, TEST_USER_PASSWORD);
    expect((await count(headers)).status).toBe(200);
    await prisma.membership.update({ where: { id: user.membershipId ?? "" }, data: { isActive: false } });
    expect((await count(headers)).status).toBe(403);
    expect((await open(headers)).status).toBe(403);
  });
});

describe("store isolation", () => {
  it("shows each store only its own notifications, with events in both at once", async () => {
    await Promise.all([markAllSeen(a), markAllSeen(b)]);
    const [inA, inB] = await Promise.all([book(a), book(b)]);

    expect(await count(a.staff)).toEqual({ status: 200, count: 1 });
    expect(await count(b.staff)).toEqual({ status: 200, count: 1 });
    const listA = (await open(a.owner)).body?.items ?? [];
    const listB = (await open(b.owner)).body?.items ?? [];
    expect(listA.map((item) => item.href)).toContain(`/orders/${inA}`);
    expect(listA.map((item) => item.href)).not.toContain(`/orders/${inB}`);
    expect(listB.map((item) => item.href)).toEqual([`/orders/${inB}`]);
    expect(listA.every((item) => item.orderNumber.startsWith("BT-"))).toBe(true);
  });

  it("ignores any store or order sent with the request: the store comes from the membership", async () => {
    await markAllSeen(b);
    const headers = new Headers(b.staff);
    headers.set("x-store-id", a.id);
    const response = await GET(new Request(`${getServerEnv().BETTER_AUTH_URL}/api/v1/notifications?storeId=${a.id}`, { headers }));
    expect(await response.json()).toEqual({ count: 0 });
  });

  it("is refused by the database when a notification's store differs from its order's", async () => {
    const orderInA = await book(a);
    await expect(
      prisma.notification.create({
        data: { storeId: b.id, orderId: orderInA, type: "ONLINE_BOOKING", sourceId: orderInA, audience: "STAFF_AND_OWNERS" },
      }),
    ).rejects.toThrow();
    expect(await prisma.notification.count({ where: { storeId: b.id, orderId: orderInA } })).toBe(0);
  });

  it("is refused by the database when the audience doesn't match the type", async () => {
    const orderId = await book(a);
    await expect(
      prisma.notification.create({
        data: { storeId: a.id, orderId, type: "PAYMENT_NEEDS_REVIEW", sourceId: randomUUID(), audience: "STAFF_AND_OWNERS" },
      }),
    ).rejects.toThrow();
  });
});

describe("writing notifications", () => {
  it("keeps one per event, however often the event is retried", async () => {
    const orderId = await book(a);
    const event = { storeId: a.id, orderId, type: "PAYMENT_RECEIVED" as const, sourceId: `payment-${randomUUID()}` };
    await getPrisma().$transaction((tx) => addStaffNotification(tx, event));
    await getPrisma().$transaction((tx) => addStaffNotification(tx, event));
    await Promise.all([
      getPrisma().$transaction((tx) => addStaffNotification(tx, event)),
      getPrisma().$transaction((tx) => addStaffNotification(tx, event)),
    ]);
    expect(await prisma.notification.count({ where: { storeId: a.id, sourceId: event.sourceId } })).toBe(1);
  });

  it("leaves none when the event's transaction rolls back", async () => {
    const orderId = await book(a);
    const sourceId = `payment-${randomUUID()}`;
    await expect(
      getPrisma().$transaction(async (tx) => {
        await addStaffNotification(tx, { storeId: a.id, orderId, type: "PAYMENT_RECEIVED", sourceId });
        throw new Error("The event failed");
      }),
    ).rejects.toThrow("The event failed");
    expect(await prisma.notification.count({ where: { sourceId } })).toBe(0);
  });
});

describe("the scheduled job", () => {
  it("deletes notifications older than 30 days and keeps the rest", async () => {
    const orderId = await book(a);
    const old = await prisma.notification.create({
      data: {
        storeId: a.id,
        orderId,
        type: "PRICE_DECLINED",
        sourceId: `old-${randomUUID()}`,
        audience: "STAFF_AND_OWNERS",
        createdAt: new Date(Date.now() - 31 * DAY),
      },
      select: { id: true },
    });

    expect(await clearOldNotifications(new Date())).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.notification.count({ where: { orderId, type: "ONLINE_BOOKING" } })).toBe(1);
  });
});
