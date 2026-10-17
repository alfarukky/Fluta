import { randomUUID } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { FulfilmentType, OrderStage, PrismaClient } from "@/generated/prisma/client";
import { getTrackingMetadata } from "@/components/tracking/tracking-page";
import { TrackingOrder } from "@/components/tracking/TrackingOrder";
import { toMatchKey } from "@/lib/match-key";
import { generateToken, hashToken } from "@/lib/tokens";
import { getPrisma } from "@/server/data/client";
import { canTransition, getStageOrderState, toContext } from "@/server/domain/order-stages";
import { getOrderDetail } from "@/server/services/orders";
import { loadTrackingPage } from "@/server/services/tracking";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import nextConfig, { PRIVATE_LINK_HEADERS } from "../../next.config";

import { changeOrderStage } from "./order-stages";
import { confirmPickupTime, suggestPickupTime } from "./pickup-times";
import { issueRevision, recordDecision } from "./quotes";
import { acceptPickupTime, decidePriceUpdate } from "./tracking";
import { issueTrackingLink } from "./tracking-links";

// Staff actions read the session from next/headers; here it's the headers of
// whoever the test signed in as. Customer actions need no session at all.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.setConfig({ testTimeout: 90_000 });

const EMAIL_DOMAIN = "tracking-test.example";
const PASSWORD = "test-password-1234";
const DAY = 24 * 60 * 60 * 1000;
const NOT_CURRENT = "This price update is no longer current.";
const CHANGED = "This order was just updated. Please check the latest details.";

// Kept off the tracking page, whatever happens.
const CUSTOMER_PHONE = "+2348031234521";
const ADDRESS = "14 Hidden Close, Wuse 2";
const INTERNAL_NOTE = "Gate code 4417, staff only";
const CUSTOMER_NOTE = "Please be gentle with the silk blouse";
const STAFF_NAME = "Tunde Staffname";

const SHIRT_PRICE = 80_000;
const WASH_PRICE = 150_000;
const WUSE_CHARGE = 150_000;

let prisma: PrismaClient;
let storeId: string;
let customerId: string;
let ids: { shirt: string; wash: string; wuse: string; maitama: string };
let staff: { id: string; headers: Headers };
let nextOrderNumber = 1;

beforeAll(async () => {
  prisma = createTestPrisma();
  const suffix = randomUUID().slice(0, 8);
  const store = await prisma.store.create({
    data: {
      name: "Tracking Test Laundry",
      slug: `tracking-test-${suffix}`,
      orderPrefix: "TT",
      phone: "+2348030000099",
      pickupDeliveryEnabled: true,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      openTime: "08:00",
      closeTime: "18:00",
      // No customer messages: a price update message would issue a fresh
      // link, and these tests follow each order's first one. Messages and
      // their links are tested in notifications.integration.test.ts.
      smsEnabled: false,
      emailCopiesEnabled: false,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: { name: "Tracking Test Customer", phone: CUSTOMER_PHONE } },
    },
    select: { id: true, customers: { select: { id: true } } },
  });
  storeId = store.id;
  customerId = store.customers[0].id;

  const service = (name: string, pricingType: "PER_ITEM" | "PER_KG", price: number) =>
    prisma.service.create({
      data: { storeId, name, nameKey: toMatchKey(name), pricingType, price, requiresQuote: pricingType === "PER_KG" },
      select: { id: true },
    });
  const area = (name: string, fixedCharge: number | null) =>
    prisma.serviceArea.create({
      data: { storeId, name, nameKey: toMatchKey(name), chargeType: fixedCharge === null ? "QUOTE_REQUIRED" : "FIXED", fixedCharge },
      select: { id: true },
    });
  const [shirt, wash, wuse, maitama] = await Promise.all([
    service("Shirt", "PER_ITEM", SHIRT_PRICE),
    service("Wash & fold", "PER_KG", WASH_PRICE),
    area("Wuse 2", WUSE_CHARGE),
    area("Maitama", null),
  ]);
  ids = { shirt: shirt.id, wash: wash.id, wuse: wuse.id, maitama: maitama.id };

  const email = `staff-${suffix}@${EMAIL_DOMAIN}`;
  const { createUserWithPassword } = await import("@/server/data/users");
  const { createMembership } = await import("@/server/data/memberships");
  const { id } = await createUserWithPassword({ name: STAFF_NAME, email, password: PASSWORD }, prisma);
  const membership = await createMembership(storeId, { userId: id, role: "STAFF" }, prisma);
  if (!membership.success) throw new Error("Couldn't add the staff member");
  staff = { id, headers: await signInHeaders(email, PASSWORD) };
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, revisions, or audit events.
  const where = { storeId };
  await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
  await prisma.$transaction(
    [
      prisma.auditEvent.deleteMany({ where }),
      prisma.messageEvent.deleteMany({ where }),
      prisma.statusEvent.deleteMany({ where }),
      prisma.payment.deleteMany({ where }),
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
  await prisma.session.deleteMany({ where: { userId: staff.id } });
  await prisma.account.deleteMany({ where: { userId: staff.id } });
  await prisma.user.deleteMany({ where: { id: staff.id } });
  await prisma.store.delete({ where: { id: storeId } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

// ───────────── Building orders ─────────────

interface LineSpec {
  service: "shirt" | "wash";
  quantity: number | null; // hundredths; null = not weighed yet
}

interface OrderSpec {
  fulfilmentType?: FulfilmentType;
  path: OrderStage[];
  lines?: LineSpec[];
  // Version 1 approved at creation (a priced order); otherwise an estimate.
  approved?: boolean;
  area?: "wuse" | "maitama";
  // A pickup the customer requested online, or one staff agreed.
  pickup?: "REQUESTED" | "CONFIRMED";
  // Completed or cancelled this many days ago (the path's last stage).
  closedDaysAgo?: number;
  paid?: number;
}

const priceOf = (line: LineSpec) => (line.service === "shirt" ? SHIRT_PRICE : WASH_PRICE);
const totalOf = (line: LineSpec) => (line.quantity === null ? 0 : Math.round((priceOf(line) * line.quantity) / 100));
const REQUESTED_DATE = new Date(Date.UTC(2026, 11, 1));

// An order as order entry, an online booking, and earlier moves would have
// left it, with a tracking token only the test knows.
async function makeOrder(spec: OrderSpec): Promise<{ id: string; token: string; displayNumber: string }> {
  const fulfilmentType = spec.fulfilmentType ?? "DROP_OFF";
  const pickup = fulfilmentType === "PICKUP_DELIVERY";
  const stage = spec.path.at(-1) ?? "BOOKED";
  const lines = spec.lines ?? [{ service: "shirt", quantity: 200 }];
  const charge = pickup ? (spec.area === "maitama" ? null : WUSE_CHARGE) : null;
  const itemsSubtotal = lines.reduce((sum, line) => sum + totalOf(line), 0);
  const total = itemsSubtotal + (charge ?? 0);
  const approved = spec.approved ?? true;
  const closedAt = spec.closedDaysAgo === undefined ? null : new Date(Date.now() - spec.closedDaysAgo * DAY);
  const start = new Date(Date.now() - 100 * DAY);
  const at = (index: number) => new Date(start.getTime() + index * 60_000);
  const token = generateToken();
  const orderNumber = nextOrderNumber++;
  const requested = spec.pickup === "REQUESTED";

  const order = await prisma.order.create({
    data: {
      storeId,
      orderNumber,
      customerId,
      channel: requested ? "ONLINE" : "COUNTER",
      fulfilmentType,
      stage,
      stageBeforeQuote: stage === "QUOTE_AWAITING_APPROVAL" ? spec.path.at(-2) : null,
      serviceAreaId: pickup ? ids[spec.area ?? "wuse"] : null,
      serviceAreaName: pickup ? (spec.area === "maitama" ? "Maitama" : "Wuse 2") : null,
      fulfilmentCharge: charge,
      addressText: pickup ? ADDRESS : null,
      ...(pickup && {
        requestedPickupDate: REQUESTED_DATE,
        requestedWindowStart: "10:00",
        requestedWindowEnd: "12:00",
        pickupWindowStatus: requested ? "REQUESTED" : "CONFIRMED",
        ...(!requested && { scheduledPickupDate: REQUESTED_DATE, scheduledWindowStart: "10:00", scheduledWindowEnd: "12:00" }),
      }),
      internalNote: INTERNAL_NOTE,
      customerNote: CUSTOMER_NOTE,
      trackingTokenHash: hashToken(token),
      trackingTokenIssuedAt: at(0),
      completedAt: stage === "COMPLETED" ? closedAt : null,
      cancelledAt: stage === "CANCELLED" ? closedAt : null,
      createdAt: at(0),
    },
    select: { id: true },
  });
  await prisma.orderLine.createMany({
    data: lines.map((line) => ({
      storeId,
      orderId: order.id,
      lineType: "SERVICE" as const,
      serviceId: ids[line.service],
      description: line.service === "shirt" ? "Shirt" : "Wash & fold",
      pricingType: line.service === "shirt" ? ("PER_ITEM" as const) : ("PER_KG" as const),
      requiresQuote: line.service === "wash",
      unitPrice: priceOf(line),
      quantity: line.quantity === null ? null : (line.quantity / 100).toFixed(2),
      lineTotal: line.quantity === null ? null : totalOf(line),
    })),
  });
  const v1 = await prisma.quoteRevision.create({
    data: {
      storeId,
      orderId: order.id,
      version: 1,
      linesSnapshot: {
        lines: lines.flatMap((line) =>
          line.quantity === null
            ? []
            : [
                {
                  lineType: "SERVICE",
                  serviceId: ids[line.service],
                  description: line.service === "shirt" ? "Shirt" : "Wash & fold",
                  pricingType: line.service === "shirt" ? "PER_ITEM" : "PER_KG",
                  requiresQuote: line.service === "wash",
                  unitPrice: priceOf(line),
                  quantity: (line.quantity / 100).toFixed(2),
                  quantityIsEstimate: false,
                  lineTotal: totalOf(line),
                },
              ],
        ),
        areaName: pickup ? "Wuse 2" : null,
        isOutOfArea: false,
        fulfilmentCharge: charge,
      },
      itemsSubtotal,
      fulfilmentCharge: charge ?? 0,
      total,
      status: approved ? "APPROVED" : "PENDING",
      createdByActor: requested ? "CUSTOMER" : "STAFF",
      createdByUserId: requested ? null : staff.id,
      createdAt: at(0),
      approvedAt: approved ? at(0) : null,
      approvedByActor: approved ? (requested ? "CUSTOMER" : "STAFF") : null,
    },
    select: { id: true },
  });
  if (approved) await prisma.order.update({ where: { id: order.id }, data: { approvedQuoteId: v1.id } });
  await prisma.statusEvent.createMany({
    data: spec.path.map((toStage, index) => ({
      storeId,
      orderId: order.id,
      fromStage: index === 0 ? null : spec.path[index - 1],
      toStage,
      actorType: "STAFF" as const,
      actorUserId: staff.id,
      createdAt: closedAt && index === spec.path.length - 1 ? closedAt : at(index + 1),
    })),
  });
  if (spec.paid) {
    await prisma.payment.create({
      data: {
        storeId,
        orderId: order.id,
        amount: spec.paid,
        source: "STORE_COLLECTED",
        method: "CASH",
        status: "CONFIRMED",
        recordedByUserId: staff.id,
        confirmedAt: at(1),
      },
    });
  }
  return { id: order.id, token, displayNumber: `TT-${orderNumber}` };
}

async function readOrder(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      stage: true,
      stageBeforeQuote: true,
      approvedQuoteId: true,
      trackingTokenHash: true,
      internalNote: true,
      isOutsideSchedule: true,
      requestedPickupDate: true,
      requestedWindowStart: true,
      requestedWindowEnd: true,
      scheduledPickupDate: true,
      scheduledWindowStart: true,
      scheduledWindowEnd: true,
      pickupWindowStatus: true,
      lines: { select: { id: true, lineType: true, quantity: true }, orderBy: [{ lineType: "asc" }, { id: "asc" }] },
      quoteRevisions: {
        select: { id: true, version: true, status: true, approvedByActor: true, customerMessage: true },
        orderBy: { version: "asc" },
      },
      statusEvents: {
        select: { fromStage: true, toStage: true, actorType: true, actorUserId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

// Staff send a price update: every service line priced, with the area's
// charge where it's still to be quoted.
async function sendPriceUpdate(
  orderId: string,
  options: { quantity?: number; charge?: string | null; reason?: string | null } = {},
): Promise<string> {
  const order = await readOrder(orderId);
  request.headers = staff.headers;
  const result = await issueRevision({
    orderId,
    basedOnVersion: order.quoteRevisions.at(-1)?.version ?? 1,
    lines: order.lines
      .filter((line) => line.lineType === "SERVICE")
      .map((line) => ({
        kind: "existing" as const,
        lineId: line.id,
        quantity: String((options.quantity ?? (line.quantity === null ? 300 : Number(line.quantity) * 100)) / 100),
      })),
    adjustments: [],
    ...(options.charge && { charge: options.charge }),
    reason: options.reason === undefined ? "Heavier than expected" : options.reason,
  });
  expect(result).toEqual({ ok: true, message: expect.any(String) });
  return (await readOrder(orderId)).quoteRevisions.at(-1)?.id ?? "";
}

async function asStaff<T>(action: () => Promise<T>): Promise<T> {
  request.headers = staff.headers;
  return action();
}

const tokenOf = (url: string) => new URL(url).pathname.split("/").at(-1) ?? "";

// ───────────── Opening a link ─────────────

describe("opening a tracking link", () => {
  it("opens only its own order, and an unknown or altered token opens nothing", async () => {
    const [first, second] = [await makeOrder({ path: ["RECEIVED_BY_STORE"] }), await makeOrder({ path: ["RECEIVED_BY_STORE"] })];

    for (const order of [first, second]) {
      const page = await loadTrackingPage(order.token);
      expect(page).toMatchObject({ kind: "VALID", view: { displayNumber: order.displayNumber, stageLabel: "At the store" } });
    }
    const altered = `${first.token.slice(0, -1)}${first.token.endsWith("A") ? "B" : "A"}`;
    for (const token of [altered, generateToken(), "short", `${first.token}x`, hashToken(first.token)]) {
      expect(await loadTrackingPage(token)).toEqual({ kind: "NOT_FOUND" });
    }
  });

  it("never acts on another order, even with its revision ID", async () => {
    const mine = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"] });
    const other = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"] });
    const otherRevision = await sendPriceUpdate(other.id, { quantity: 300 });

    expect(await decidePriceUpdate(mine.token, { decision: "APPROVE", revisionId: otherRevision })).toEqual({
      ok: false,
      message: NOT_CURRENT,
    });
    expect((await readOrder(other.id)).quoteRevisions.at(-1)).toMatchObject({ status: "PENDING", approvedByActor: null });
  });

  it("shows the expired message once closed over 30 days with nothing owed, but keeps working while a refund is owed", async () => {
    const recent = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS", "READY", "COMPLETED"], closedDaysAgo: 29, paid: 160_000 });
    const expired = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS", "READY", "COMPLETED"], closedDaysAgo: 31, paid: 160_000 });
    const refundOwed = await makeOrder({ path: ["RECEIVED_BY_STORE", "CANCELLED"], closedDaysAgo: 90, paid: 160_000 });

    expect(await loadTrackingPage(recent.token)).toMatchObject({ kind: "VALID", view: { closed: true, payment: "Paid" } });
    expect(await loadTrackingPage(expired.token)).toEqual({
      kind: "EXPIRED",
      storeName: "Tracking Test Laundry",
      storePhone: "+234 803 000 0099",
      storePhoneHref: "tel:+2348030000099",
    });
    expect(await loadTrackingPage(refundOwed.token)).toMatchObject({
      kind: "VALID",
      view: { stageLabel: "Cancelled", payment: "The store will refund ₦1,600" },
    });
  });

  it("shows nothing about a Deactivated store's order", async () => {
    const order = await makeOrder({ path: ["RECEIVED_BY_STORE"] });
    await prisma.store.update({ where: { id: storeId }, data: { status: "DEACTIVATED" } });
    try {
      expect(await loadTrackingPage(order.token)).toEqual({ kind: "UNAVAILABLE" });
      expect(await getTrackingMetadata(order.token)).toMatchObject({ title: "Order not available" });
    } finally {
      await prisma.store.update({ where: { id: storeId }, data: { status: "ACTIVE" } });
    }
  });

  it("never shows the full address, full phone, internal note, customer note, or staff names", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"], pickup: "REQUESTED" });
    await asStaff(() =>
      suggestPickupTime({ orderId: order.id, date: "2026-12-02", outsideSchedule: true, windowStart: "07:00", windowEnd: "08:00", note: INTERNAL_NOTE }),
    );
    const page = await loadTrackingPage(order.token);
    if (page.kind !== "VALID") throw new Error("The link should work");

    const html = renderToStaticMarkup(TrackingOrder({ view: page.view, basePath: "/o/test" }));
    const metadata = JSON.stringify(await getTrackingMetadata(order.token));
    for (const text of [JSON.stringify(page.view), html]) {
      for (const secret of [ADDRESS, "Hidden Close", CUSTOMER_PHONE, "803 123 4521", INTERNAL_NOTE, CUSTOMER_NOTE, STAFF_NAME, "Tracking Test Customer"]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(page.view.maskedPhone).toBe("+234 803 *** 4521");
    expect(html).toContain("+234 803 *** 4521");
    expect(page.view.pickup).toEqual({ area: "Wuse 2", date: "Wed, 2 Dec 2026", time: "7:00 AM–8:00 AM", status: "Suggested by the store" });

    // A link preview: the store's name and "View your laundry order" only.
    expect(metadata).toContain("Tracking Test Laundry");
    expect(metadata).toContain("View your laundry order");
    for (const secret of [order.displayNumber, "Shirt", "Booking received", "₦", "Wuse 2", ADDRESS]) expect(metadata).not.toContain(secret);
  });

  it("sends no-referrer, no-store, and noindex for the page and its actions", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((candidate) => candidate.source === "/o/:token/:path*");
    expect(rule?.headers).toEqual(PRIVATE_LINK_HEADERS);
    expect(PRIVATE_LINK_HEADERS).toEqual(
      expect.arrayContaining([
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ]),
    );
    // ":path*" is zero or more segments, so the rule covers the page, its
    // review screens, and the actions they post to (Server Actions post to the
    // page's own path).

    const order = await makeOrder({ path: ["RECEIVED_BY_STORE"] });
    expect(await getTrackingMetadata(order.token)).toMatchObject({
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    });
    expect(await getTrackingMetadata(generateToken())).toMatchObject({ robots: { index: false, follow: false } });
  });
});

// ───────────── Get tracking link ─────────────

describe("Get tracking link", () => {
  it("issues a new link, so the old one stops working, and records who did it", async () => {
    const order = await makeOrder({ path: ["RECEIVED_BY_STORE"] });
    const result = await asStaff(() => issueTrackingLink({ orderId: order.id }));
    if (!result.ok) throw new Error(result.message);

    expect(await loadTrackingPage(order.token)).toEqual({ kind: "NOT_FOUND" });
    expect(await loadTrackingPage(tokenOf(result.url))).toMatchObject({ kind: "VALID", view: { displayNumber: order.displayNumber } });

    const audits = await prisma.auditEvent.findMany({ where: { storeId, targetId: order.id, action: "TRACKING_LINK_ISSUED" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: "STAFF", actorUserId: staff.id, targetType: "Order" });
    // The audit never holds the token or its hash.
    expect(JSON.stringify(audits[0])).not.toContain(tokenOf(result.url));
    expect(JSON.stringify(audits[0])).not.toContain(hashToken(tokenOf(result.url)));
  });

  it("leaves only the last link working when two are issued at the same moment", async () => {
    const order = await makeOrder({ path: ["RECEIVED_BY_STORE"] });
    const results = await asStaff(() =>
      Promise.all([issueTrackingLink({ orderId: order.id }), issueTrackingLink({ orderId: order.id })]),
    );
    const tokens = results.map((result) => (result.ok ? tokenOf(result.url) : ""));
    expect(tokens.every(Boolean)).toBe(true);

    const pages = await Promise.all(tokens.map((token) => loadTrackingPage(token)));
    expect(pages.filter((page) => page.kind === "VALID")).toHaveLength(1);
    expect((await readOrder(order.id)).trackingTokenHash).toBe(hashToken(tokens[pages.findIndex((page) => page.kind === "VALID")]));
  });

  it("isn't offered for an order whose link would already be expired", async () => {
    const expired = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS", "READY", "COMPLETED"], closedDaysAgo: 40, paid: 160_000 });
    const open = await makeOrder({ path: ["RECEIVED_BY_STORE"] });

    expect((await getOrderDetail(storeId, expired.id, "STAFF"))?.canIssueTrackingLink).toBe(false);
    expect((await getOrderDetail(storeId, open.id, "STAFF"))?.canIssueTrackingLink).toBe(true);
    const result = await asStaff(() => issueTrackingLink({ orderId: expired.id }));
    expect(result).toMatchObject({ ok: false });
    expect((await readOrder(expired.id)).trackingTokenHash).toBe(hashToken(expired.token));
  });

  it("can't issue a link for another store's order", async () => {
    const cleanWave = await prisma.order.findFirstOrThrow({ where: { store: { slug: "cleanwave-laundry" } }, select: { id: true, trackingTokenHash: true } });
    expect(await asStaff(() => issueTrackingLink({ orderId: cleanWave.id }))).toEqual({ ok: false, message: "Order not found." });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: cleanWave.id } })).trackingTokenHash).toBe(cleanWave.trackingTokenHash);
  });
});

// ───────────── Price updates ─────────────

describe("approving and declining a price update", () => {
  it("approves through Feature 12's operation, returning to the earlier stage without scheduling a pickup", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", area: "maitama", path: ["BOOKED"], pickup: "REQUESTED", approved: false });
    const revisionId = await sendPriceUpdate(order.id, { charge: "2,000", reason: null });
    expect(await readOrder(order.id)).toMatchObject({ stage: "QUOTE_AWAITING_APPROVAL", stageBeforeQuote: "BOOKED" });

    const page = await loadTrackingPage(order.token);
    expect(page).toMatchObject({
      kind: "VALID",
      view: { stageLabel: "Waiting for your approval", priceUpdate: { revisionId, previousTotal: null, charge: "₦2,000" } },
    });
    // Plain words only: never "quote", "revision", or "version".
    const visible = JSON.stringify(page, (key, value: unknown) => (key.endsWith("Id") ? undefined : value));
    expect(visible).not.toMatch(/quote|revision|version/i);

    expect(await decidePriceUpdate(order.token, { decision: "APPROVE", revisionId })).toEqual({
      ok: true,
      message: "Thank you. You approved the new price.",
    });
    const after = await readOrder(order.id);
    expect(after).toMatchObject({
      stage: "BOOKED",
      stageBeforeQuote: null,
      approvedQuoteId: revisionId,
      pickupWindowStatus: "REQUESTED",
      scheduledPickupDate: null,
    });
    expect(after.quoteRevisions.at(-1)).toMatchObject({ status: "APPROVED", approvedByActor: "CUSTOMER" });
    expect(after.statusEvents.at(-1)).toMatchObject({ fromStage: "QUOTE_AWAITING_APPROVAL", toStage: "BOOKED", actorType: "SYSTEM" });
  });

  it("keeps the progress shown while a price update waits during cleaning", async () => {
    const order = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"] });
    await sendPriceUpdate(order.id, { quantity: 300 });
    const page = await loadTrackingPage(order.token);
    if (page.kind !== "VALID") throw new Error("The link should work");
    expect(page.view.timeline.map((step) => `${step.state} ${step.label}`)).toEqual([
      "done At the store",
      "current Being cleaned",
      "upcoming Ready for collection",
      "upcoming Completed",
    ]);
    expect(page.view.priceUpdate).toMatchObject({ previousTotal: "₦1,600", newTotal: "₦2,400", difference: "+₦800", direction: "up" });
    // The approved price still shows, labelled Total.
    expect(page.view.price).toMatchObject({ kind: "approved", total: "₦1,600" });
  });

  it("refuses an update that was replaced, as no longer current", async () => {
    const order = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"] });
    const replaced = await sendPriceUpdate(order.id, { quantity: 300 });
    const latest = await sendPriceUpdate(order.id, { quantity: 400 });

    expect(await decidePriceUpdate(order.token, { decision: "APPROVE", revisionId: replaced })).toEqual({ ok: false, message: NOT_CURRENT });
    expect(await decidePriceUpdate(order.token, { decision: "APPROVE", revisionId: latest })).toMatchObject({ ok: true });
    expect(await decidePriceUpdate(order.token, { decision: "DECLINE", revisionId: latest, message: null })).toEqual({
      ok: false,
      message: NOT_CURRENT,
    });
  });

  it("declines with a message and changes nothing else", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"], pickup: "REQUESTED" });
    const revisionId = await sendPriceUpdate(order.id, { quantity: 300 });
    const before = await readOrder(order.id);
    const balanceBefore = (await getOrderDetail(storeId, order.id, "STAFF"))?.balance;

    expect(
      await decidePriceUpdate(order.token, { decision: "DECLINE", revisionId, message: "  Can you check the count again?  " }),
    ).toEqual({ ok: true, message: "Thank you. We've let the store know." });

    const after = await readOrder(order.id);
    const { quoteRevisions: revisionsBefore, ...restBefore } = before;
    const { quoteRevisions: revisionsAfter, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect(revisionsAfter.slice(0, -1)).toEqual(revisionsBefore.slice(0, -1));
    expect(revisionsAfter.at(-1)).toMatchObject({ status: "DECLINED", customerMessage: "Can you check the count again?" });
    expect((await getOrderDetail(storeId, order.id, "STAFF"))?.balance).toEqual(balanceBefore);
  });

  it("refuses a message over 300 characters", async () => {
    const order = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"] });
    const revisionId = await sendPriceUpdate(order.id, { quantity: 300 });
    expect(await decidePriceUpdate(order.token, { decision: "DECLINE", revisionId, message: "x".repeat(301) })).toMatchObject({ ok: false });
    expect((await readOrder(order.id)).quoteRevisions.at(-1)).toMatchObject({ status: "PENDING" });
  });

  it("applies exactly one of a customer approval and a staff decision made at the same moment", async () => {
    const order = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"] });
    const revisionId = await sendPriceUpdate(order.id, { quantity: 300 });
    request.headers = staff.headers;
    const [customer, store] = await Promise.all([
      decidePriceUpdate(order.token, { decision: "APPROVE", revisionId }),
      recordDecision({ decision: "DECLINE", orderId: order.id, revisionId, customerMessage: "Too much", note: null }),
    ]);
    expect([customer.ok, store.ok].filter(Boolean)).toHaveLength(1);
    const revision = (await readOrder(order.id)).quoteRevisions.at(-1);
    expect(revision?.status).toBe(customer.ok ? "APPROVED" : "DECLINED");
  });

  it("refuses every customer action once the order is closed or the link expired", async () => {
    const order = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"] });
    const revisionId = await sendPriceUpdate(order.id, { quantity: 300 });
    await prisma.order.update({ where: { id: order.id }, data: { stage: "CANCELLED", cancelledAt: new Date() } });

    expect(await decidePriceUpdate(order.token, { decision: "APPROVE", revisionId })).toEqual({
      ok: false,
      message: "This order is cancelled, so it can't be changed.",
    });
    expect(await loadTrackingPage(order.token)).toMatchObject({ kind: "VALID", view: { closed: true, priceUpdate: null } });

    await prisma.order.update({ where: { id: order.id }, data: { cancelledAt: new Date(Date.now() - 40 * DAY) } });
    expect(await decidePriceUpdate(order.token, { decision: "APPROVE", revisionId })).toEqual({
      ok: false,
      message: "This link has expired. Please contact Tracking Test Laundry.",
    });
    expect((await readOrder(order.id)).quoteRevisions.at(-1)).toMatchObject({ status: "PENDING" });
  });
});

// ───────────── Pickup times ─────────────

describe("pickup times", () => {
  it("staff confirm the requested time, and the order moves to Pickup scheduled", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"], pickup: "REQUESTED" });
    expect(await asStaff(() => confirmPickupTime({ orderId: order.id }))).toEqual({ ok: true, message: "Pickup time confirmed" });

    const after = await readOrder(order.id);
    expect(after).toMatchObject({
      stage: "PICKUP_SCHEDULED",
      pickupWindowStatus: "CONFIRMED",
      scheduledPickupDate: REQUESTED_DATE,
      scheduledWindowStart: "10:00",
      scheduledWindowEnd: "12:00",
      requestedPickupDate: REQUESTED_DATE,
    });
    expect(after.statusEvents.at(-1)).toEqual({ fromStage: "BOOKED", toStage: "PICKUP_SCHEDULED", actorType: "STAFF", actorUserId: staff.id });
    expect(await loadTrackingPage(order.token)).toMatchObject({
      view: { stageLabel: "Pickup scheduled", pickup: { status: "Confirmed" } },
    });
    // Confirming twice: the second finds it already confirmed.
    expect(await asStaff(() => confirmPickupTime({ orderId: order.id }))).toMatchObject({ ok: false });
  });

  it("staff suggest a time and replace it, and the customer can accept only the latest", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"], pickup: "REQUESTED" });
    const suggest = (date: string, windowStart: string, windowEnd: string) =>
      asStaff(() => suggestPickupTime({ orderId: order.id, date, outsideSchedule: false, windowStart, windowEnd }));

    expect(await suggest("2026-12-03", "14:00", "16:00")).toEqual({ ok: true, message: "Pickup time suggested to the customer" });
    const first = await loadTrackingPage(order.token);
    if (first.kind !== "VALID" || !first.view.pickupSuggestion) throw new Error("The suggestion should show");
    const older = first.view.pickupSuggestion.suggestionId;
    expect(first.view.pickupSuggestion).toMatchObject({ date: "Thu, 3 Dec 2026", time: "2:00 PM–4:00 PM" });
    expect(await readOrder(order.id)).toMatchObject({ stage: "BOOKED", pickupWindowStatus: "PROPOSED_BY_STORE" });

    expect(await suggest("2026-12-04", "08:00", "10:00")).toMatchObject({ ok: true });
    const second = await loadTrackingPage(order.token);
    if (second.kind !== "VALID" || !second.view.pickupSuggestion) throw new Error("The suggestion should show");
    const latest = second.view.pickupSuggestion.suggestionId;
    expect(latest).not.toBe(older);

    expect(await acceptPickupTime(order.token, { suggestionId: older })).toEqual({ ok: false, message: CHANGED });
    expect(await readOrder(order.id)).toMatchObject({ stage: "BOOKED", pickupWindowStatus: "PROPOSED_BY_STORE" });

    expect(await acceptPickupTime(order.token, { suggestionId: latest })).toEqual({ ok: true, message: "Thank you. Your pickup time is confirmed." });
    const after = await readOrder(order.id);
    expect(after).toMatchObject({
      stage: "PICKUP_SCHEDULED",
      pickupWindowStatus: "CONFIRMED",
      scheduledPickupDate: new Date(Date.UTC(2026, 11, 4)),
      scheduledWindowStart: "08:00",
      // The customer's own request is kept.
      requestedPickupDate: REQUESTED_DATE,
      requestedWindowStart: "10:00",
    });
    expect(after.statusEvents.at(-1)).toEqual({ fromStage: "BOOKED", toStage: "PICKUP_SCHEDULED", actorType: "CUSTOMER", actorUserId: null });

    // One audit event per suggestion, both shown in the staff timeline.
    const detail = await getOrderDetail(storeId, order.id, "STAFF");
    const suggestions = detail?.timeline.filter((entry) => entry.kind === "pickupSuggested") ?? [];
    expect(suggestions.map((entry) => (entry.kind === "pickupSuggested" ? entry.suggestion.date : ""))).toEqual(["2026-12-04", "2026-12-03"]);
  });

  it("sets isOutsideSchedule for each suggestion, keeping the note in its audit event only", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"], pickup: "REQUESTED" });
    const note = "Customer leaves for work at 7";

    expect(
      await asStaff(() =>
        suggestPickupTime({ orderId: order.id, date: "2026-12-05", outsideSchedule: true, windowStart: "06:30", windowEnd: "07:15", note }),
      ),
    ).toMatchObject({ ok: true });
    expect(await readOrder(order.id)).toMatchObject({ isOutsideSchedule: true, internalNote: INTERNAL_NOTE, scheduledWindowStart: "06:30" });

    expect(
      await asStaff(() =>
        suggestPickupTime({ orderId: order.id, date: "2026-12-05", outsideSchedule: false, windowStart: "08:00", windowEnd: "10:00", note: "ignored" }),
      ),
    ).toMatchObject({ ok: true });
    expect(await readOrder(order.id)).toMatchObject({ isOutsideSchedule: false, internalNote: INTERNAL_NOTE });

    const audits = await prisma.auditEvent.findMany({
      where: { storeId, targetId: order.id, action: "PICKUP_TIME_SUGGESTED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(audits.map((audit) => audit.metadata)).toEqual([
      { date: "2026-12-05", windowStart: "06:30", windowEnd: "07:15", isOutsideSchedule: true, note },
      { date: "2026-12-05", windowStart: "08:00", windowEnd: "10:00", isOutsideSchedule: false, note: null },
    ]);
    expect(audits.every((audit) => audit.actorType === "STAFF" && audit.actorUserId === staff.id)).toBe(true);
  });

  it("checks suggestions against the schedule, and requires a note outside it", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"], pickup: "REQUESTED" });
    const suggest = (body: Record<string, unknown>) =>
      asStaff(() => suggestPickupTime({ orderId: order.id, date: "2026-12-05", outsideSchedule: false, windowStart: "08:00", windowEnd: "10:00", ...body }));

    expect(await suggest({ windowStart: "09:00", windowEnd: "11:00" })).toMatchObject({ ok: false, field: "window" });
    expect(await suggest({ date: "2020-01-01" })).toMatchObject({ ok: false, field: "date" });
    expect(await suggest({ outsideSchedule: true, windowStart: "06:00", windowEnd: "07:00", note: "" })).toMatchObject({
      ok: false,
      fieldErrors: { note: expect.any(String) },
    });
    expect(await readOrder(order.id)).toMatchObject({ pickupWindowStatus: "REQUESTED", scheduledPickupDate: null });
  });

  it("refuses pickup time changes while a pickup charge awaits approval", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", area: "maitama", path: ["BOOKED"], pickup: "REQUESTED", approved: false });
    await asStaff(() => suggestPickupTime({ orderId: order.id, date: "2026-12-05", outsideSchedule: false, windowStart: "08:00", windowEnd: "10:00" }));
    const page = await loadTrackingPage(order.token);
    const suggestionId = page.kind === "VALID" ? page.view.pickupSuggestion?.suggestionId : undefined;
    const revisionId = await sendPriceUpdate(order.id, { charge: "2,500", reason: null });

    const confirm = await asStaff(() => confirmPickupTime({ orderId: order.id }));
    const suggest = await asStaff(() =>
      suggestPickupTime({ orderId: order.id, date: "2026-12-06", outsideSchedule: false, windowStart: "08:00", windowEnd: "10:00" }),
    );
    for (const result of [confirm, suggest]) {
      expect(result).toEqual({ ok: false, message: expect.stringContaining("Waiting for the customer to approve the pickup charge") });
    }
    expect(await acceptPickupTime(order.token, { suggestionId: suggestionId ?? "" })).toMatchObject({ ok: false });
    expect((await getOrderDetail(storeId, order.id, "STAFF"))?.pickupTime).toMatchObject({ canConfirm: false, canSuggest: false });

    // Declined: the pickup time stays as it was, and staff send another price update.
    expect(await decidePriceUpdate(order.token, { decision: "DECLINE", revisionId, message: null })).toMatchObject({ ok: true });
    expect(await readOrder(order.id)).toMatchObject({
      stage: "QUOTE_AWAITING_APPROVAL",
      pickupWindowStatus: "PROPOSED_BY_STORE",
      scheduledWindowStart: "08:00",
    });
  });

  it("lets only one of a staff change and a customer accept made at the same moment apply", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"], pickup: "REQUESTED" });
    await asStaff(() => suggestPickupTime({ orderId: order.id, date: "2026-12-05", outsideSchedule: false, windowStart: "08:00", windowEnd: "10:00" }));
    const page = await loadTrackingPage(order.token);
    const suggestionId = page.kind === "VALID" ? (page.view.pickupSuggestion?.suggestionId ?? "") : "";

    request.headers = staff.headers;
    const [customer, store] = await Promise.all([
      acceptPickupTime(order.token, { suggestionId }),
      suggestPickupTime({ orderId: order.id, date: "2026-12-06", outsideSchedule: false, windowStart: "12:00", windowEnd: "14:00" }),
    ]);
    expect([customer.ok, store.ok].filter(Boolean)).toHaveLength(1);
    const after = await readOrder(order.id);
    if (customer.ok) expect(after).toMatchObject({ stage: "PICKUP_SCHEDULED", scheduledWindowStart: "08:00" });
    else expect(after).toMatchObject({ stage: "BOOKED", pickupWindowStatus: "PROPOSED_BY_STORE", scheduledWindowStart: "12:00" });
  });

  it("refuses staff changes to another store's order", async () => {
    const cleanWave = await prisma.order.findFirstOrThrow({ where: { store: { slug: "cleanwave-laundry" } }, select: { id: true } });
    expect(await asStaff(() => confirmPickupTime({ orderId: cleanWave.id }))).toEqual({ ok: false, message: "Order not found." });
    expect(
      await asStaff(() =>
        suggestPickupTime({ orderId: cleanWave.id, date: "2026-12-05", outsideSchedule: false, windowStart: "08:00", windowEnd: "10:00" }),
      ),
    ).toEqual({ ok: false, message: "Order not found." });
  });
});

// ───────────── Stepping a pickup order back to Booked ─────────────

describe("stepping a pickup order back to Booked", () => {
  it("returns the pickup time to the customer's request, records it, and offers Confirm or Suggest again", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"], pickup: "REQUESTED" });
    await asStaff(() =>
      suggestPickupTime({ orderId: order.id, date: "2026-12-07", outsideSchedule: true, windowStart: "07:00", windowEnd: "08:00", note: "Before work" }),
    );
    const suggested = await loadTrackingPage(order.token);
    const suggestionId = suggested.kind === "VALID" ? (suggested.view.pickupSuggestion?.suggestionId ?? "") : "";
    expect(await acceptPickupTime(order.token, { suggestionId })).toMatchObject({ ok: true });
    expect(await readOrder(order.id)).toMatchObject({ stage: "PICKUP_SCHEDULED", pickupWindowStatus: "CONFIRMED", isOutsideSchedule: true });

    expect(
      await asStaff(() =>
        changeOrderStage({ orderId: order.id, from: "PICKUP_SCHEDULED", to: "BOOKED", note: "Driver couldn't reach the customer" }),
      ),
    ).toEqual({ ok: true, message: "Order moved to Booked" });

    // One transaction: the stage, the time back to Requested, and the cleared time recorded.
    const after = await readOrder(order.id);
    expect(after).toMatchObject({
      stage: "BOOKED",
      pickupWindowStatus: "REQUESTED",
      scheduledPickupDate: null,
      scheduledWindowStart: null,
      scheduledWindowEnd: null,
      isOutsideSchedule: false,
      requestedPickupDate: REQUESTED_DATE,
      requestedWindowStart: "10:00",
      requestedWindowEnd: "12:00",
    });
    expect(after.statusEvents.at(-1)).toEqual({ fromStage: "PICKUP_SCHEDULED", toStage: "BOOKED", actorType: "STAFF", actorUserId: staff.id });
    const resets = await prisma.auditEvent.findMany({ where: { storeId, targetId: order.id, action: "PICKUP_TIME_RESET" } });
    expect(resets).toHaveLength(1);
    expect(resets[0]).toMatchObject({
      actorType: "STAFF",
      actorUserId: staff.id,
      targetType: "Order",
      metadata: { date: "2026-12-07", windowStart: "07:00", windowEnd: "08:00", isOutsideSchedule: true },
    });

    // Staff: the card offers Confirm requested time and Suggest again, and the
    // timeline shows the reset after the step back.
    const detail = await getOrderDetail(storeId, order.id, "STAFF");
    expect(detail?.pickupTime).toEqual({ status: "REQUESTED", canConfirm: true, canSuggest: true, blockedReason: null });
    expect(detail?.timeline[0]).toMatchObject({
      kind: "pickupReset",
      reset: { date: "2026-12-07", windowStart: "07:00", windowEnd: "08:00", isOutsideSchedule: true, actorUserId: staff.id },
    });
    expect(detail?.timeline[1]).toMatchObject({ kind: "stage", event: { fromStage: "PICKUP_SCHEDULED", toStage: "BOOKED" } });

    // Staff can confirm the requested time again.
    expect(await asStaff(() => confirmPickupTime({ orderId: order.id }))).toEqual({ ok: true, message: "Pickup time confirmed" });
    expect(await readOrder(order.id)).toMatchObject({ stage: "PICKUP_SCHEDULED", pickupWindowStatus: "CONFIRMED", scheduledWindowStart: "10:00" });
  });

  it("shows the customer their requested time again, with nothing to accept", async () => {
    const order = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"], pickup: "REQUESTED" });
    await asStaff(() =>
      suggestPickupTime({ orderId: order.id, date: "2026-12-08", outsideSchedule: false, windowStart: "14:00", windowEnd: "16:00" }),
    );
    const suggested = await loadTrackingPage(order.token);
    const suggestionId = suggested.kind === "VALID" ? (suggested.view.pickupSuggestion?.suggestionId ?? "") : "";
    await acceptPickupTime(order.token, { suggestionId });
    await asStaff(() => changeOrderStage({ orderId: order.id, from: "PICKUP_SCHEDULED", to: "BOOKED", note: "Wrong day" }));

    const page = await loadTrackingPage(order.token);
    if (page.kind !== "VALID") throw new Error("The link should work");
    expect(page.view).toMatchObject({
      stageLabel: "Booking received",
      pickup: { area: "Wuse 2", date: "Tue, 1 Dec 2026", time: "10:00 AM–12:00 PM", status: "Requested" },
      pickupSuggestion: null,
      priceUpdate: null,
    });
    expect(page.view.timeline.slice(0, 2).map((step) => `${step.state} ${step.label}`)).toEqual([
      "current Booking received",
      "upcoming Pickup scheduled",
    ]);
    // The suggestion it accepted before can't be accepted again.
    expect(await acceptPickupTime(order.token, { suggestionId })).toEqual({ ok: false, message: CHANGED });
    expect(await readOrder(order.id)).toMatchObject({ stage: "BOOKED", pickupWindowStatus: "REQUESTED" });
  });

  it("leaves a drop-off order's step back to Booked as it was", async () => {
    const order = await makeOrder({ path: ["BOOKED", "RECEIVED_BY_STORE"] });
    expect(
      await asStaff(() => changeOrderStage({ orderId: order.id, from: "RECEIVED_BY_STORE", to: "BOOKED", note: "Not dropped off yet" })),
    ).toMatchObject({ ok: true });
    expect(await readOrder(order.id)).toMatchObject({ stage: "BOOKED", pickupWindowStatus: null });
    expect(await prisma.auditEvent.count({ where: { storeId, targetId: order.id, action: "PICKUP_TIME_RESET" } })).toBe(0);
  });

  it("never lets the seeded phone pickup order step back to Booked: it starts at Pickup scheduled", async () => {
    const seeded = await prisma.order.findFirstOrThrow({
      where: { store: { slug: "freshfold-laundry" }, channel: "PHONE", fulfilmentType: "PICKUP_DELIVERY" },
      select: {
        stage: true,
        fulfilmentType: true,
        stageBeforeQuote: true,
        pickupWindowStatus: true,
        approvedQuoteId: true,
        quoteRevisions: { select: { version: true, status: true, approvedAt: true, declinedAt: true } },
        statusEvents: { select: { id: true, fromStage: true, toStage: true, createdAt: true } },
      },
    });
    const state = getStageOrderState(seeded);
    expect(state.startingStage).toBe("PICKUP_SCHEDULED");
    expect(canTransition("PICKUP_SCHEDULED", "BOOKED", toContext({ ...state, stage: "PICKUP_SCHEDULED" }, "OWNER", "note", false))).toMatchObject({
      allowed: false,
    });
  });
});
