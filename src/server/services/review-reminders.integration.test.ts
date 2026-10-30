import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { submitReview } from "@/actions/reviews";
import { GET as runCronJob } from "@/app/api/cron/messages/route";
import { getServerEnv } from "@/lib/env";
import { describeMessageStatus } from "@/lib/messages";
import { generateToken, hashToken } from "@/lib/tokens";
import { getPrisma } from "@/server/data/client";
import { createTestPrisma, insertThenRollBack } from "@/test/integration/db";
import { fakeMailer, fakeSms } from "@/test/integration/fakes";

import { queueReviewReminders, sendMessage } from "./notifications";

// Feature 19b: the one review reminder email per order, queued by the
// scheduled job about 3 hours after completion, in the store's daytime only,
// and checked again just before each attempt to send it.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.setConfig({ testTimeout: 120_000 });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const REVIEW = "REVIEW_REQUEST";

let prisma: PrismaClient;
// Each store's time zone makes it the middle of the day, or of the night,
// there right now, whenever the tests run.
let day: TestStore;
let night: TestStore;
let noCopies: TestStore;

interface TestStore {
  id: string;
  name: string;
  prefix: string;
  nextOrderNumber: number;
}

// A fixed-offset zone where the local hour is `hour` now ("Etc/GMT-5" is UTC+5).
function zoneAt(hour: number): string {
  const offset = ((hour - new Date().getUTCHours() + 36) % 24) - 12;
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  [day, night, noCopies] = await Promise.all([
    createStore("Reminder Day Laundry", "RD", zoneAt(13), true),
    createStore("Reminder Night Laundry", "RN", zoneAt(1), true),
    createStore("Reminder Quiet Laundry", "RQ", zoneAt(13), false),
  ]);
}, 120_000);

beforeEach(() => {
  fakeMailer.reset();
  fakeSms.reset();
});

afterAll(async () => {
  // Test cleanup only: the app never deletes messages, reviews, or orders.
  const where = { storeId: { in: [day.id, night.id, noCopies.id] } };
  await prisma.$transaction(
    [
      prisma.notification.deleteMany({ where }),
      prisma.review.deleteMany({ where }),
      prisma.messageEvent.deleteMany({ where }),
      prisma.order.deleteMany({ where }),
      prisma.customer.deleteMany({ where }),
      prisma.subscription.deleteMany({ where }),
    ],
    { maxWait: 15_000, timeout: 30_000 },
  );
  await prisma.store.deleteMany({ where: { id: { in: [day.id, night.id, noCopies.id] } } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function createStore(name: string, prefix: string, timeZone: string, emailCopiesEnabled: boolean): Promise<TestStore> {
  const store = await prisma.store.create({
    data: {
      name,
      slug: `reminders-test-${randomUUID().slice(0, 8)}`,
      orderPrefix: prefix,
      timeZone,
      phone: "+2348030000077",
      smsEnabled: true,
      emailCopiesEnabled,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
    },
    select: { id: true },
  });
  return { id: store.id, name, prefix, nextOrderNumber: 1 };
}

interface OrderSpec {
  completedAgoMs?: number;
  email?: string | null;
}

// A completed drop-off order for a new customer, with a token only the test knows.
async function makeOrder(store: TestStore, spec: OrderSpec = {}) {
  const email = spec.email === undefined ? `customer-${randomUUID().slice(0, 8)}@reminders-test.example` : spec.email;
  const customer = await prisma.customer.create({
    data: { storeId: store.id, name: "Ada Customer", phone: `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, email },
    select: { id: true },
  });
  const token = generateToken();
  const orderNumber = store.nextOrderNumber++;
  const order = await prisma.order.create({
    data: {
      storeId: store.id,
      orderNumber,
      customerId: customer.id,
      channel: "COUNTER",
      fulfilmentType: "DROP_OFF",
      stage: "COMPLETED",
      trackingTokenHash: hashToken(token),
      trackingTokenIssuedAt: new Date(Date.now() - 2 * DAY),
      completedAt: new Date(Date.now() - (spec.completedAgoMs ?? 4 * HOUR)),
      createdAt: new Date(Date.now() - 2 * DAY),
    },
    select: { id: true },
  });
  return { id: order.id, token, email, displayNumber: `${store.prefix}-${orderNumber}` };
}

async function remindersOf(orderId: string) {
  return prisma.messageEvent.findMany({ where: { orderId, template: REVIEW }, orderBy: { createdAt: "asc" } });
}

async function runCron() {
  const response = await runCronJob(
    new Request("http://localhost/api/cron/messages", { headers: { authorization: `Bearer ${getServerEnv().CRON_SECRET}` } }),
  );
  expect(response.status).toBe(200);
  return response.json();
}

// The token in the reminder's link.
function tokenIn(text: string): string {
  const match = /\/o\/([A-Za-z0-9_-]{43})/.exec(text);
  if (!match) throw new Error("No link in the email");
  return match[1];
}

// ───────────── Queuing ─────────────

describe("the scheduled job", () => {
  it("queues and sends one review email per eligible order, never twice across runs", async () => {
    const order = await makeOrder(day);
    expect((await runCron()).reviewReminders).toBeGreaterThanOrEqual(1);

    const [reminder, ...more] = await remindersOf(order.id);
    expect(more).toHaveLength(0);
    expect(reminder).toMatchObject({ channel: "EMAIL", status: "SENT", recipient: order.email, body: null, createdByUserId: null });

    const email = fakeMailer.lastTo(order.email ?? "");
    expect(email?.subject).toBe(`${day.name}: thank you for your order ${order.displayNumber}`);
    expect(email?.text).toContain(`Thank you for your order ${order.displayNumber}. How did we do?`);
    expect(fakeSms.sent).toHaveLength(0);

    // The link is fresh: it opens the order, and the old one no longer does.
    const fresh = tokenIn(email?.text ?? "");
    expect(fresh).not.toBe(order.token);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { trackingTokenHash: true } });
    expect(stored.trackingTokenHash).toBe(hashToken(fresh));

    await runCron();
    await queueReviewReminders(new Date());
    expect(await remindersOf(order.id)).toHaveLength(1);
    expect(fakeMailer.sent.filter((sent) => sent.to === order.email)).toHaveLength(1);
  });

  it("waits 3 hours after completion", async () => {
    const early = await makeOrder(day, { completedAgoMs: 2 * HOUR + 50 * 60_000 });
    await queueReviewReminders(new Date());
    expect(await remindersOf(early.id)).toHaveLength(0);

    await prisma.order.update({ where: { id: early.id }, data: { completedAt: new Date(Date.now() - 3 * HOUR - 60_000) } });
    await queueReviewReminders(new Date());
    expect(await remindersOf(early.id)).toHaveLength(1);
  });

  it("sends nothing at night in the store's time zone", async () => {
    const order = await makeOrder(night, { completedAgoMs: 6 * HOUR });
    await queueReviewReminders(new Date());
    expect(await remindersOf(order.id)).toHaveLength(0);
  });

  it("queues nothing once the customer has reviewed, without an email, with email copies off, or after 7 days", async () => {
    const reviewed = await makeOrder(day);
    expect((await submitReview(reviewed.token, { rating: 5 })).ok).toBe(true);
    const noEmail = await makeOrder(day, { email: null });
    const quiet = await makeOrder(noCopies);
    const old = await makeOrder(day, { completedAgoMs: 7 * DAY + 60_000 });
    const reopened = await makeOrder(day);
    await prisma.order.update({ where: { id: reopened.id }, data: { stage: "READY", completedAt: null } });

    await queueReviewReminders(new Date());
    for (const order of [reviewed, noEmail, quiet, old, reopened]) expect(await remindersOf(order.id)).toHaveLength(0);
  });

  it("never sends a reopened and completed-again order a second reminder", async () => {
    const order = await makeOrder(day);
    await queueReviewReminders(new Date());
    expect(await remindersOf(order.id)).toHaveLength(1);

    await prisma.order.update({ where: { id: order.id }, data: { stage: "READY", completedAt: null } });
    await prisma.order.update({ where: { id: order.id }, data: { stage: "COMPLETED", completedAt: new Date(Date.now() - 4 * HOUR) } });
    await queueReviewReminders(new Date());
    expect(await remindersOf(order.id)).toHaveLength(1);
  });

  it("allows one review email per order in the database, even from two runs at once", async () => {
    const orders = await Promise.all([makeOrder(day), makeOrder(day)]);
    await Promise.all([queueReviewReminders(new Date()), queueReviewReminders(new Date()), queueReviewReminders(new Date())]);
    for (const order of orders) expect(await remindersOf(order.id)).toHaveLength(1);

    const [first] = await remindersOf(orders[0].id);
    await expect(
      insertThenRollBack(prisma, (tx) =>
        tx.messageEvent.create({
          data: { storeId: day.id, orderId: orders[0].id, channel: "EMAIL", template: REVIEW, recipient: first?.recipient ?? "x@y.z" },
        }),
      ),
    ).rejects.toMatchObject({ code: "P2002" });

    // Other messages for the order are still allowed.
    await insertThenRollBack(prisma, (tx) =>
      tx.messageEvent.create({ data: { storeId: day.id, orderId: orders[0].id, channel: "EMAIL", template: "READY", recipient: "x@y.z" } }),
    );
  });
});

// ───────────── The last check before sending ─────────────

describe("a retried review email", () => {
  // Queued while the mailer is down, so its first attempt fails and it waits for a retry.
  async function failedReminder() {
    const order = await makeOrder(day);
    fakeMailer.failSends = true;
    await queueReviewReminders(new Date());
    const [reminder] = await remindersOf(order.id);
    if (!reminder) throw new Error("The reminder should be queued");
    expect(await sendMessage(day.id, reminder.id)).toBe("FAILED");
    fakeMailer.failSends = false;
    return { order, reminder };
  }

  async function expectNotNeeded(messageId: string, now: Date = new Date()) {
    expect(await sendMessage(day.id, messageId, now)).toBe("NOT_NEEDED");
    const message = await prisma.messageEvent.findUniqueOrThrow({ where: { id: messageId } });
    expect(message).toMatchObject({ status: "REPLACED", body: null, lastError: "No longer needed" });
    expect(describeMessageStatus(message).label).toBe("No longer needed");
    expect(fakeMailer.sent).toHaveLength(0);
  }

  it("is still sent when it is still needed", async () => {
    const { reminder } = await failedReminder();
    expect(await sendMessage(day.id, reminder.id)).toBe("SENT");
  });

  it("isn't sent once the customer has reviewed", async () => {
    const { reminder } = await failedReminder();
    // The customer reviews through the reminder's own link.
    expect((await submitReview(tokenIn(reminder.body ?? ""), { rating: 4 })).ok).toBe(true);
    await expectNotNeeded(reminder.id);
  });

  it("isn't sent once the order is reopened or cancelled", async () => {
    const reopened = await failedReminder();
    await prisma.order.update({ where: { id: reopened.order.id }, data: { stage: "READY", completedAt: null } });
    await expectNotNeeded(reopened.reminder.id);

    const cancelled = await failedReminder();
    await prisma.order.update({ where: { id: cancelled.order.id }, data: { stage: "CANCELLED", completedAt: null, cancelledAt: new Date() } });
    await expectNotNeeded(cancelled.reminder.id);
  });

  it("isn't sent once the review window has ended", async () => {
    const { reminder } = await failedReminder();
    await expectNotNeeded(reminder.id, new Date(Date.now() + 7 * DAY));
  });

  it("is replaced, unsent, when staff send a newer link", async () => {
    const { order, reminder } = await failedReminder();
    const { replaceUnsentLinkMessages } = await import("@/server/data/tracking");
    await prisma.$transaction((tx) => replaceUnsentLinkMessages(tx, day.id, { id: order.id }));
    expect(await prisma.messageEvent.findUniqueOrThrow({ where: { id: reminder.id } })).toMatchObject({ status: "REPLACED", body: null });
    expect(await sendMessage(day.id, reminder.id)).toBe("NOT_CLAIMED");
  });
});
