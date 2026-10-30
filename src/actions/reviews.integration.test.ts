import { randomUUID } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { OrderStage, PrismaClient, StoreRole } from "@/generated/prisma/client";
import { TrackingOrder } from "@/components/tracking/TrackingOrder";
import { generateToken, hashToken } from "@/lib/tokens";
import { getPrisma } from "@/server/data/client";
import { requireStoreMember } from "@/server/auth/session";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";
import { loadBookingPage } from "@/server/services/booking";
import { getReviewsPageData, REVIEW_MESSAGES } from "@/server/services/reviews";
import { openNotificationBell } from "@/server/services/staff-notifications";
import { loadTrackingPage, TRACKING_MESSAGES } from "@/server/services/tracking";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { loadMoreReviews, submitReview } from "./reviews";

// Feature 19b: customers rating a completed order through its private link,
// once, and owners and staff (never riders) seeing the store's reviews.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.setConfig({ testTimeout: 90_000 });

const EMAIL_DOMAIN = "reviews-test.example";
const PASSWORD = "test-password-1234";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CUSTOMER_NAME = "Musa Reviewer";
const CUSTOMER_PHONE = "+2348031234588";
const ADDRESS = "7 Quiet Lane, Garki";

interface TestStore {
  id: string;
  slug: string;
  customerId: string;
  nextOrderNumber: number;
}

interface Member {
  id: string;
  membershipId: string;
  role: StoreRole;
  headers: Headers;
}

let prisma: PrismaClient;
let freshFold: TestStore;
let cleanWave: TestStore;
let owner: Member;
let staff: Member;
let rider: Member;
let otherOwner: Member;
const userIds: string[] = [];

beforeAll(async () => {
  prisma = createTestPrisma();
  [freshFold, cleanWave] = await Promise.all([createStore("Review Fresh Laundry", "RF"), createStore("Review Wave Laundry", "RW")]);
  owner = await addMember(freshFold, "owner", "OWNER");
  staff = await addMember(freshFold, "staff", "STAFF");
  rider = await addMember(freshFold, "rider", "RIDER");
  otherOwner = await addMember(cleanWave, "other-owner", "OWNER");
}, 180_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes reviews, notifications, or orders.
  const where = { storeId: { in: [freshFold.id, cleanWave.id] } };
  await prisma.$transaction(
    [
      prisma.notification.deleteMany({ where }),
      prisma.review.deleteMany({ where }),
      prisma.messageEvent.deleteMany({ where }),
      prisma.statusEvent.deleteMany({ where }),
      prisma.order.deleteMany({ where }),
      prisma.customer.deleteMany({ where }),
      prisma.subscription.deleteMany({ where }),
      prisma.membership.deleteMany({ where }),
      prisma.auditEvent.deleteMany({ where }),
    ],
    { maxWait: 15_000, timeout: 30_000 },
  );
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.store.deleteMany({ where: { id: { in: [freshFold.id, cleanWave.id] } } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function createStore(name: string, prefix: string): Promise<TestStore> {
  const suffix = randomUUID().slice(0, 8);
  const store = await prisma.store.create({
    data: {
      name,
      slug: `reviews-test-${suffix}`,
      orderPrefix: prefix,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      openTime: "08:00",
      closeTime: "18:00",
      // No customer messages: these tests follow each order's own link.
      smsEnabled: false,
      emailCopiesEnabled: false,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: { name: CUSTOMER_NAME, phone: CUSTOMER_PHONE } },
    },
    select: { id: true, slug: true, customers: { select: { id: true } } },
  });
  return { id: store.id, slug: store.slug, customerId: store.customers[0].id, nextOrderNumber: 1 };
}

async function addMember(store: TestStore, label: string, role: StoreRole): Promise<Member> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const { id } = await createUserWithPassword({ name: `Review ${label}`, email, password: PASSWORD }, prisma);
  userIds.push(id);
  const membership = await createMembership(store.id, { userId: id, role }, prisma);
  if (!membership.success) throw new Error(`Couldn't add the ${label}`);
  const { id: membershipId } = await prisma.membership.findFirstOrThrow({ where: { storeId: store.id, userId: id }, select: { id: true } });
  return { id, membershipId, role, headers: await signInHeaders(email, PASSWORD) };
}

interface OrderSpec {
  stage?: OrderStage;
  // Completed (or cancelled) this long ago.
  closedAgoMs?: number;
}

// A drop-off order with a tracking token only the test knows.
async function makeOrder(store: TestStore, spec: OrderSpec = {}): Promise<{ id: string; token: string; displayNumber: string }> {
  const stage = spec.stage ?? "COMPLETED";
  const closedAt = new Date(Date.now() - (spec.closedAgoMs ?? HOUR));
  const token = generateToken();
  const orderNumber = store.nextOrderNumber++;
  const order = await prisma.order.create({
    data: {
      storeId: store.id,
      orderNumber,
      customerId: store.customerId,
      channel: "COUNTER",
      fulfilmentType: "DROP_OFF",
      stage,
      addressText: ADDRESS,
      trackingTokenHash: hashToken(token),
      trackingTokenIssuedAt: new Date(Date.now() - 10 * DAY),
      completedAt: stage === "COMPLETED" ? closedAt : null,
      cancelledAt: stage === "CANCELLED" ? closedAt : null,
      createdAt: new Date(Date.now() - 10 * DAY),
    },
    select: { id: true, store: { select: { orderPrefix: true } } },
  });
  return { id: order.id, token, displayNumber: `${order.store.orderPrefix}-${orderNumber}` };
}

async function reviewsOf(orderId: string) {
  return prisma.review.findMany({ where: { orderId } });
}

async function trackingView(token: string) {
  const page = await loadTrackingPage(token);
  if (page.kind !== "VALID") throw new Error(`The link should work, got ${page.kind}`);
  return page.view;
}

// ───────────── Leaving a review ─────────────

describe("a customer reviewing their order", () => {
  it("can review a completed order through its link, once only", async () => {
    const order = await makeOrder(freshFold);
    expect((await trackingView(order.token)).review).toEqual({ kind: "form", storeName: "Review Fresh Laundry" });

    const result = await submitReview(order.token, { rating: 4, comment: "  Pickup was on time · Great value  " });
    expect(result).toEqual({ ok: true, message: REVIEW_MESSAGES.thanks, rating: 4 });
    const [saved] = await reviewsOf(order.id);
    expect(saved).toMatchObject({ storeId: freshFold.id, rating: 4, comment: "Pickup was on time · Great value" });
    expect((await trackingView(order.token)).review).toEqual({ kind: "thanks", rating: 4 });

    // A second submit just gets the thank-you, with the saved stars, and changes nothing.
    expect(await submitReview(order.token, { rating: 1, comment: "Changed my mind" })).toEqual({
      ok: true,
      message: REVIEW_MESSAGES.thanks,
      rating: 4,
    });
    expect(await reviewsOf(order.id)).toEqual([saved]);
  });

  it("stores an empty comment as NULL", async () => {
    const order = await makeOrder(freshFold);
    expect((await submitReview(order.token, { rating: 5, comment: "   " })).ok).toBe(true);
    expect((await reviewsOf(order.id))[0]?.comment).toBeNull();
  });

  it("creates one review when two submits arrive at the same moment", async () => {
    const order = await makeOrder(freshFold);
    const results = await Promise.all([
      submitReview(order.token, { rating: 5, comment: "First" }),
      submitReview(order.token, { rating: 2, comment: "Second" }),
      submitReview(order.token, { rating: 3 }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await reviewsOf(order.id)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { orderId: order.id, type: "REVIEW_RECEIVED" } })).toBe(1);
  });

  it("refuses orders that aren't completed, are cancelled, or are past 7 days", async () => {
    const ready = await makeOrder(freshFold, { stage: "READY" });
    const cancelled = await makeOrder(freshFold, { stage: "CANCELLED" });
    const old = await makeOrder(freshFold, { closedAgoMs: 7 * DAY + 60_000 });
    const lastMinute = await makeOrder(freshFold, { closedAgoMs: 7 * DAY - 60_000 });

    expect(await submitReview(ready.token, { rating: 5 })).toEqual({ ok: false, message: REVIEW_MESSAGES.notCompleted });
    expect(await submitReview(cancelled.token, { rating: 5 })).toEqual({ ok: false, message: REVIEW_MESSAGES.notCompleted });
    expect(await submitReview(old.token, { rating: 5 })).toEqual({ ok: false, message: REVIEW_MESSAGES.windowEnded });
    for (const order of [ready, cancelled, old]) {
      expect(await reviewsOf(order.id)).toHaveLength(0);
      expect((await trackingView(order.token)).review).toBeNull();
    }
    expect((await submitReview(lastMinute.token, { rating: 5 })).ok).toBe(true);
  });

  it("refuses an unknown, malformed, replaced, or expired link, and a Deactivated store", async () => {
    expect(await submitReview(generateToken(), { rating: 5 })).toEqual({ ok: false, message: TRACKING_MESSAGES.invalid });
    expect(await submitReview("not-a-token", { rating: 5 })).toEqual({ ok: false, message: TRACKING_MESSAGES.invalid });
    expect(await submitReview(42, { rating: 5 })).toEqual({ ok: false, message: TRACKING_MESSAGES.invalid });

    // Replaced by a newer link: the old token finds nothing.
    const replaced = await makeOrder(freshFold);
    await prisma.order.update({ where: { id: replaced.id }, data: { trackingTokenHash: hashToken(generateToken()) } });
    expect(await submitReview(replaced.token, { rating: 5 })).toEqual({ ok: false, message: TRACKING_MESSAGES.invalid });

    // Expired: closed more than 30 days ago.
    const expired = await makeOrder(freshFold, { closedAgoMs: 31 * DAY });
    expect((await submitReview(expired.token, { rating: 5 })).ok).toBe(false);

    const deactivated = await createStore("Review Gone Laundry", "RG");
    try {
      const order = await makeOrder(deactivated);
      await prisma.store.update({ where: { id: deactivated.id }, data: { status: "DEACTIVATED" } });
      expect(await submitReview(order.token, { rating: 5 })).toEqual({ ok: false, message: TRACKING_MESSAGES.unavailable });
      expect(await reviewsOf(order.id)).toHaveLength(0);
    } finally {
      const where = { storeId: deactivated.id };
      await prisma.order.deleteMany({ where });
      await prisma.customer.deleteMany({ where });
      await prisma.subscription.deleteMany({ where });
      await prisma.store.delete({ where: { id: deactivated.id } });
    }
    for (const order of [replaced, expired]) expect(await reviewsOf(order.id)).toHaveLength(0);
  });

  it("refuses a rating outside 1 to 5 and a comment over 300 characters", async () => {
    const order = await makeOrder(freshFold);
    for (const rating of [0, 6, 2.5, "5", null]) expect((await submitReview(order.token, { rating })).ok).toBe(false);
    expect(await submitReview(order.token, { rating: 4, comment: "a".repeat(301) })).toEqual({
      ok: false,
      message: "Your comment must be 300 characters or fewer",
    });
    expect(await reviewsOf(order.id)).toHaveLength(0);
  });

  it("hides the card while reopened, and never gives a second review after completing again", async () => {
    const order = await makeOrder(freshFold);
    // Reopened before any review: the card goes.
    await prisma.order.update({ where: { id: order.id }, data: { stage: "READY", completedAt: null } });
    expect((await trackingView(order.token)).review).toBeNull();
    expect((await submitReview(order.token, { rating: 5 })).ok).toBe(false);

    // Completed again: the 7 days count from the new completion.
    await prisma.order.update({ where: { id: order.id }, data: { stage: "COMPLETED", completedAt: new Date() } });
    expect((await trackingView(order.token)).review?.kind).toBe("form");
    expect((await submitReview(order.token, { rating: 3, comment: "Good, but slow" })).ok).toBe(true);

    // A review is permanent: reopening keeps it, and completing again doesn't open a second.
    await prisma.order.update({ where: { id: order.id }, data: { stage: "READY", completedAt: null } });
    expect((await trackingView(order.token)).review).toEqual({ kind: "thanks", rating: 3 });
    await prisma.order.update({ where: { id: order.id }, data: { stage: "COMPLETED", completedAt: new Date() } });
    expect(await submitReview(order.token, { rating: 5 })).toEqual({ ok: true, message: REVIEW_MESSAGES.thanks, rating: 3 });
    expect(await reviewsOf(order.id)).toMatchObject([{ rating: 3 }]);

    // Cancelled later: still there.
    await prisma.order.update({ where: { id: order.id }, data: { stage: "CANCELLED", completedAt: null, cancelledAt: new Date() } });
    expect(await reviewsOf(order.id)).toHaveLength(1);
  });

  it("never changes the order itself", async () => {
    const order = await makeOrder(freshFold);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    await submitReview(order.token, { rating: 2, comment: "Items were damaged" });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toEqual(before);
  });

  it("refuses a review for another store's order in the database", async () => {
    const order = await makeOrder(freshFold);
    await expect(prisma.review.create({ data: { storeId: cleanWave.id, orderId: order.id, rating: 5 } })).rejects.toThrow();
    await expect(prisma.review.create({ data: { storeId: freshFold.id, orderId: order.id, rating: 6 } })).rejects.toThrow();
    await expect(prisma.review.create({ data: { storeId: freshFold.id, orderId: order.id, rating: 5, comment: "" } })).rejects.toThrow();
    expect(await reviewsOf(order.id)).toHaveLength(0);
  });
});

// ───────────── The staff notification ─────────────

describe("the staff notification", () => {
  it("creates one per new review, with the stars and never the comment", async () => {
    const order = await makeOrder(freshFold);
    await submitReview(order.token, { rating: 5, comment: "Secret comment for the store" });
    await submitReview(order.token, { rating: 1 });

    const [review] = await reviewsOf(order.id);
    const notifications = await prisma.notification.findMany({ where: { orderId: order.id } });
    expect(notifications).toMatchObject([{ type: "REVIEW_RECEIVED", sourceId: review?.id, audience: "STAFF_AND_OWNERS" }]);

    const items = await openNotificationBell({ storeId: freshFold.id, timeZone: "Africa/Lagos", membershipId: staff.membershipId, role: "STAFF", notificationsSeenAt: null });
    const item = items?.find((entry) => entry.href.endsWith(order.id));
    expect(item?.text).toBe(`${CUSTOMER_NAME} rated ${order.displayNumber} ★★★★★ (5 out of 5)`);
    expect(JSON.stringify(items)).not.toContain("Secret comment");

    // Riders see nothing in the bell.
    expect(await openNotificationBell({ storeId: freshFold.id, timeZone: "Africa/Lagos", membershipId: rider.membershipId, role: "RIDER", notificationsSeenAt: null })).toEqual([]);
  });
});

// ───────────── Seeing reviews ─────────────

describe("the Reviews page", () => {
  it("shows owners and staff the store's reviews, newest first, with averages", async () => {
    const store = await createStore("Review Count Laundry", "RC");
    try {
      const orders = await Promise.all([0, 1, 2].map(() => makeOrder(store)));
      await submitReview(orders[0].token, { rating: 5, comment: "Lovely" });
      await submitReview(orders[1].token, { rating: 4 });
      await submitReview(orders[2].token, { rating: 2, comment: "<b>Late</b>" });
      // Older than 30 days: all time only.
      await prisma.review.updateMany({ where: { orderId: orders[0].id }, data: { createdAt: new Date(Date.now() - 31 * DAY) } });

      const data = await getReviewsPageData({ id: store.id, orderPrefix: "RC", timeZone: "Africa/Lagos" }, { rating: null }, new Date());
      expect(data.recent).toEqual({ count: 2, average: "3.0" });
      expect(data.allTime).toEqual({ count: 3, average: "3.7" });
      expect(data.page.rows.map((row) => row.rating)).toEqual([2, 4, 5]);
      expect(data.page.rows[0]).toMatchObject({ customerName: CUSTOMER_NAME, comment: "<b>Late</b>", displayNumber: orders[2].displayNumber });
      expect(JSON.stringify(data)).not.toContain(CUSTOMER_PHONE);
      expect(JSON.stringify(data)).not.toContain(ADDRESS);

      const filtered = await getReviewsPageData({ id: store.id, orderPrefix: "RC", timeZone: "Africa/Lagos" }, { rating: 4 }, new Date());
      expect(filtered.page.rows.map((row) => row.rating)).toEqual([4]);
      // The averages are always for every review.
      expect(filtered.allTime.count).toBe(3);
    } finally {
      const where = { storeId: store.id };
      await prisma.notification.deleteMany({ where });
      await prisma.review.deleteMany({ where });
      await prisma.order.deleteMany({ where });
      await prisma.customer.deleteMany({ where });
      await prisma.subscription.deleteMany({ where });
      await prisma.store.delete({ where: { id: store.id } });
    }
  });

  it("loads more 25 at a time", async () => {
    const orders = [];
    for (let index = 0; index < 27; index++) orders.push(await makeOrder(cleanWave));
    await prisma.review.createMany({
      data: orders.map((order, index) => ({
        storeId: cleanWave.id,
        orderId: order.id,
        rating: (index % 5) + 1,
        createdAt: new Date(Date.now() - index * 60_000),
      })),
    });

    const first = await getReviewsPageData({ id: cleanWave.id, orderPrefix: "RW", timeZone: "Africa/Lagos" }, { rating: null }, new Date());
    expect(first.page.rows).toHaveLength(25);
    expect(first.page.nextCursor).not.toBeNull();

    request.headers = otherOwner.headers;
    const more = await loadMoreReviews({}, first.page.nextCursor);
    if (!more.ok) throw new Error(more.message);
    expect(more.rows).toHaveLength(2);
    expect(more.nextCursor).toBeNull();
    const ids = [...first.page.rows, ...more.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(27);
  });

  it("refuses riders, and never shows a FreshFold member a CleanWave review", async () => {
    request.headers = rider.headers;
    expect((await requireStoreMember()).allowed).toBe(false);
    expect(await loadMoreReviews({}, `${Date.now()}.zzzz`)).toEqual({ ok: false, message: "You can't view this store's reviews." });

    for (const member of [owner, staff]) {
      request.headers = member.headers;
      const access = await requireStoreMember();
      if (!access.allowed) throw new Error("Owners and staff can see reviews");
      expect(access.store.id).toBe(freshFold.id);
      const more = await loadMoreReviews({}, `${Date.now() + DAY}.zzzz`);
      if (!more.ok) throw new Error(more.message);
      const cleanWaveOrders = await prisma.order.findMany({ where: { storeId: cleanWave.id }, select: { id: true } });
      expect(more.rows.length).toBeGreaterThan(0);
      expect(more.rows.some((row) => cleanWaveOrders.some((order) => order.id === row.orderId))).toBe(false);
    }
  });

  it("never shows reviews on the booking page or any other customer page", async () => {
    const reviewed = await makeOrder(freshFold);
    const other = await makeOrder(freshFold);
    const comment = "Only the store may read this comment";
    await submitReview(reviewed.token, { rating: 1, comment });

    const booking = await loadBookingPage(freshFold.slug, new Date());
    expect(booking).not.toBeNull();
    expect(JSON.stringify(booking)).not.toContain(comment);

    // The customer's other order shows its own form, never this review.
    const otherView = await trackingView(other.token);
    expect(otherView.review).toEqual({ kind: "form", storeName: "Review Fresh Laundry" });

    // The reviewer's own page shows the thank-you card with the stars, never the comment.
    const view = await trackingView(reviewed.token);
    const html = renderToStaticMarkup(TrackingOrder({ view, basePath: `/o/${reviewed.token}`, token: reviewed.token }));
    expect(html).toContain("Thank you for your review");
    expect(html).toContain("You rated 1 out of 5");
    expect(html).not.toContain(comment);
    expect(JSON.stringify(view)).not.toContain(comment);
  });
});
