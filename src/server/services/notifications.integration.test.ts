import { randomUUID } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { createBooking } from "@/actions/booking";
import { openWhatsApp, resendMessage, sendLinkBySms } from "@/actions/messages";
import { changeOrderStage } from "@/actions/order-stages";
import { createOrder } from "@/actions/orders";
import { issueRevision } from "@/actions/quotes";
import { setCommunicationSetting } from "@/actions/store-settings";
import { issueTrackingLink } from "@/actions/tracking-links";
import { GET as runCronJob } from "@/app/api/cron/messages/route";
import TrackingNotFound from "@/app/(customer)/o/[token]/not-found";
import { CLIENT_IP_HEADER } from "@/lib/client-ip";
import { getServerEnv } from "@/lib/env";
import { describeMessageStatus } from "@/lib/messages";
import { toMatchKey } from "@/lib/match-key";
import { hashToken } from "@/lib/tokens";
import type { CreateOrderRequest } from "@/schemas/orders";
import { getPrisma } from "@/server/data/client";
import { claimMessage, queueOrderMessages, queueMessagesForOrder } from "@/server/data/messages";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";
import { customerMessages, sendMessage } from "@/server/services/notifications";
import { getOrderDetail } from "@/server/services/orders";
import { loadTrackingPage, TRACKING_MESSAGES } from "@/server/services/tracking";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { fakeMailer, fakeSms } from "@/test/integration/fakes";

// Customer messages end to end: each trigger queues its message in the
// trigger's own transaction, sends it right after the commit (to the fake
// SMS provider and mailer from src/test/integration/setup.ts), and the
// scheduled job retries what didn't go.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.setConfig({ testTimeout: 120_000 });

const EMAIL_DOMAIN = "notifications-test.example";
const PASSWORD = "test-password-1234";
const STORE_PHONE = "+2348099990000";
const FUTURE_DATE = "2099-06-15";
const HOUR = 60 * 60 * 1000;

let prisma: PrismaClient;
let main: TestStore;
let capped: TestStore;
let staff: { id: string; headers: Headers };
let owner: { id: string; headers: Headers };
// Each user belongs to one store only.
let capStaff: { id: string; headers: Headers };

interface TestStore {
  id: string;
  slug: string;
  shirt: string;
  duvet: string;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  [main, capped] = await Promise.all([createStore("Notify Test Laundry", "NT"), createStore("Cap Test Laundry", "CT")]);
  staff = await addUser("staff", "STAFF", main);
  owner = await addUser("owner", "OWNER", main);
  capStaff = await addUser("cap-staff", "STAFF", capped);
}, 180_000);

beforeEach(async () => {
  fakeSms.reset();
  fakeMailer.reset();
  request.headers = staff.headers;
  await prisma.store.updateMany({
    where: { id: { in: [main.id, capped.id] } },
    data: { smsEnabled: true, emailCopiesEnabled: true, whatsappContactEnabled: true, dailyBookingSmsCap: 100 },
  });
});

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, customers, or users.
  for (const store of [main, capped]) {
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
        prisma.subscription.deleteMany({ where }),
        prisma.membership.deleteMany({ where }),
      ],
      { maxWait: 15_000, timeout: 30_000 },
    );
  }
  const userIds = (
    await prisma.user.findMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } }, select: { id: true } })
  ).map((user) => user.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  // Includes any left by an earlier run that stopped before its cleanup.
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.store.deleteMany({ where: { id: { in: [main.id, capped.id] } } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 180_000);

async function createStore(name: string, orderPrefix: string): Promise<TestStore> {
  const slug = `notify-test-${randomUUID().slice(0, 8)}`;
  const { id } = await prisma.store.create({
    data: {
      name,
      slug,
      orderPrefix,
      phone: STORE_PHONE,
      dropOffEnabled: true,
      pickupDeliveryEnabled: true,
      subscription: { create: { planName: "Test", priceAmount: 0 } },
    },
    select: { id: true },
  });
  const service = (serviceName: string, price: number, requiresQuote: boolean) =>
    prisma.service.create({
      data: { storeId: id, name: serviceName, nameKey: toMatchKey(serviceName), pricingType: "PER_ITEM", price, requiresQuote },
      select: { id: true },
    });
  const [shirt, duvet] = await Promise.all([service("Shirt", 80_000, false), service("Duvet", 150_000, true)]);
  return { id, slug, shirt: shirt.id, duvet: duvet.id };
}

async function addUser(label: string, role: "OWNER" | "STAFF", store: TestStore) {
  const email = `${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const { id } = await createUserWithPassword({ name: `Test ${label}`, email, password: PASSWORD }, prisma);
  const result = await createMembership(store.id, { userId: id, role }, prisma);
  if (!result.success) throw new Error(`Couldn't add ${email}`);
  return { id, headers: await signInHeaders(email, PASSWORD) };
}

function staffOf(store: TestStore) {
  return store === capped ? capStaff : staff;
}

function nigerianPhone(): string {
  return `+234803${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

function ukPhone(): string {
  return `+447911123${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}

function newEmail(): string {
  return `customer-${randomUUID().slice(0, 8)}@example.com`;
}

function newIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

// ───────────── Making orders ─────────────

interface Customer {
  phone?: string;
  email?: string;
}

// A staff counter order: shirts, or one duvet at its "from" price that the
// store prices again after inspecting it.
async function staffOrder(options: { customer?: Customer; quoteRequired?: boolean; store?: TestStore } = {}) {
  const store = options.store ?? main;
  const order: CreateOrderRequest = {
    clientRequestId: randomUUID(),
    customer: { kind: "new", name: "Ada Obi", phone: options.customer?.phone ?? nigerianPhone(), email: options.customer?.email ?? "" },
    channel: "COUNTER",
    fulfilmentType: "DROP_OFF",
    pickup: null,
    serviceLines: options.quoteRequired
      ? [{ serviceId: store.duvet, quantity: "1" }]
      : [{ serviceId: store.shirt, quantity: "3" }],
    adjustments: [],
    internalNote: "",
  };
  request.headers = staffOf(store).headers;
  const result = await createOrder(order);
  if (!result.ok) throw new Error(`Order refused: ${result.code}`);
  return result.orderId;
}

// A staff pickup order, outside the schedule (no schedule is set).
async function staffPickupOrder(customer: Customer = {}) {
  request.headers = staff.headers;
  const result = await createOrder({
    clientRequestId: randomUUID(),
    customer: { kind: "new", name: "Ada Obi", phone: customer.phone ?? nigerianPhone(), email: customer.email ?? "" },
    channel: "PHONE",
    fulfilmentType: "PICKUP_DELIVERY",
    pickup: {
      area: { kind: "outOfArea", name: "Test Estate" },
      address: "12 Test Street",
      date: FUTURE_DATE,
      outsideSchedule: true,
      windowStart: "08:00",
      windowEnd: "10:00",
      charge: "0",
    },
    serviceLines: [{ serviceId: main.shirt, quantity: "2" }],
    adjustments: [],
    internalNote: "Agreed by phone, outside the schedule",
  } satisfies CreateOrderRequest);
  if (!result.ok) throw new Error(`Order refused: ${result.code}`);
  return result.orderId;
}

async function book(store: TestStore, customer: Customer = {}) {
  request.headers = new Headers({ [CLIENT_IP_HEADER]: newIp() });
  const clientRequestId = randomUUID();
  const result = await createBooking(store.slug, {
    clientRequestId,
    serviceLines: [{ serviceId: store.shirt, amount: "2" }],
    fulfilmentType: "DROP_OFF",
    pickup: null,
    customer: { name: "Bola Ade", phone: customer.phone ?? nigerianPhone(), email: customer.email ?? "" },
  });
  request.headers = staff.headers;
  if (!result.ok) throw new Error(`Booking refused: ${result.code}`);
  const order = await prisma.order.findUniqueOrThrow({
    where: { storeId_clientRequestId: { storeId: store.id, clientRequestId } },
    select: { id: true },
  });
  return { orderId: order.id, trackingUrl: result.trackingUrl };
}

async function moveStage(orderId: string, from: string, to: string) {
  request.headers = staff.headers;
  const result = await changeOrderStage({ orderId, from, to });
  if (!result.ok) throw new Error(`Move refused: ${result.message}`);
}

// Prices the duvets after inspection: a price update the customer must approve.
async function issuePriceUpdate(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { lines: { select: { id: true } }, quoteRevisions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 } },
  });
  request.headers = staff.headers;
  const result = await issueRevision({
    orderId,
    basedOnVersion: order.quoteRevisions[0].version,
    lines: [{ kind: "existing", lineId: order.lines[0].id, quantity: "2" }],
    adjustments: [],
    reason: "Two duvets, not one",
  });
  if (!result.ok) throw new Error(`Revision refused: ${result.message}`);
}

function messagesOf(orderId: string) {
  return prisma.messageEvent.findMany({ where: { orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

// The tracking token in a message's link.
function tokenIn(text: string): string {
  const match = /\/o\/([A-Za-z0-9_-]{43})/.exec(text);
  if (!match) throw new Error("No link in the message");
  return match[1];
}

async function bookingSmsToday(storeId: string): Promise<number> {
  return prisma.messageEvent.count({
    where: { storeId, channel: "SMS", template: "LINK_CREATED", createdByUserId: null, createdAt: { gte: new Date(Date.now() - 12 * HOUR) } },
  });
}

// ───────────── Triggers ─────────────

describe("each trigger", () => {
  it("queues and sends the order link when staff create an order, with the recipient saved", async () => {
    const phone = nigerianPhone();
    const orderId = await staffOrder({ customer: { phone } });

    const [message] = await messagesOf(orderId);
    expect(message).toMatchObject({
      channel: "SMS",
      template: "LINK_CREATED",
      recipient: phone,
      status: "SENT",
      attempts: 1,
      body: null,
      createdByUserId: staff.id,
    });
    expect(message.sentAt).not.toBeNull();
    expect(message.providerMessageId).toMatch(/^fake-/);

    const [sms] = fakeSms.sentTo(phone);
    expect(sms.text).toMatch(/^Notify Test Laundry: Hi Ada, we've received your order NT-\d+\. Track it here: http/);
    // The link in the SMS is the order's working link.
    expect(await loadTrackingPage(tokenIn(sms.text))).toMatchObject({ kind: "VALID" });
  });

  it("queues the order link after an online booking, with no staff user", async () => {
    const phone = nigerianPhone();
    const { orderId, trackingUrl } = await book(main, { phone });

    const [message] = await messagesOf(orderId);
    expect(message).toMatchObject({ channel: "SMS", template: "LINK_CREATED", recipient: phone, status: "SENT", createdByUserId: null });
    // The SMS carries the same link as the confirmation.
    expect(trackingUrl).not.toBeNull();
    expect(tokenIn(fakeSms.sentTo(phone)[0].text)).toBe(tokenIn(trackingUrl ?? ""));
  });

  it("queues a price update with a fresh link, so the previous link stops working", async () => {
    const phone = nigerianPhone();
    const orderId = await staffOrder({ customer: { phone }, quoteRequired: true });
    const firstToken = tokenIn(fakeSms.sentTo(phone)[0].text);

    await issuePriceUpdate(orderId);

    const messages = await messagesOf(orderId);
    expect(messages.map((message) => message.template)).toEqual(["LINK_CREATED", "QUOTE_NEEDS_APPROVAL"]);
    const update = fakeSms.sentTo(phone)[1].text;
    expect(update).toMatch(/^Notify Test Laundry: Hi Ada, there's an update to the price of your order NT-\d+ that needs your approval\./);
    expect(update).not.toMatch(/NGN|₦/);

    expect(await loadTrackingPage(firstToken)).toEqual({ kind: "NOT_FOUND" });
    expect(await loadTrackingPage(tokenIn(update))).toMatchObject({ kind: "VALID" });
  });

  it("queues Ready and On its way with no link, ending with the store's phone", async () => {
    const phone = nigerianPhone();
    const dropOff = await staffOrder({ customer: { phone } });
    await moveStage(dropOff, "RECEIVED_BY_STORE", "IN_PROGRESS");
    await moveStage(dropOff, "IN_PROGRESS", "READY");

    const pickupPhone = nigerianPhone();
    const pickup = await staffPickupOrder({ phone: pickupPhone });
    await prisma.order.update({ where: { id: pickup }, data: { stage: "READY" } });
    await moveStage(pickup, "READY", "OUT_FOR_DELIVERY");

    const ready = fakeSms.sentTo(phone).at(-1)?.text ?? "";
    const onItsWay = fakeSms.sentTo(pickupPhone).at(-1)?.text ?? "";
    expect(ready).toMatch(/^Notify Test Laundry: Hi Ada, your order NT-\d+ is ready for collection\. Thank you! Questions\? Call \+234 809 999 0000$/);
    expect(onItsWay).toMatch(/^Notify Test Laundry: Hi Ada, your order NT-\d+ is on its way to you\. See you soon! Questions\? Call \+234 809 999 0000$/);
    for (const text of [ready, onItsWay]) expect(text).not.toContain("http");

    expect((await messagesOf(dropOff)).map((message) => message.template)).toEqual(["LINK_CREATED", "READY"]);
    expect((await messagesOf(pickup)).map((message) => message.template)).toEqual(["LINK_CREATED", "OUT_FOR_DELIVERY"]);
  });

  it("leaves no message when the change is rolled back", async () => {
    const orderId = await staffOrder();
    const before = await messagesOf(orderId);

    await expect(
      getPrisma().$transaction(async (tx) => {
        await queueOrderMessages(tx, main.id, orderId, customerMessages({ template: "READY", createdByUserId: staff.id }), new Date());
        throw new Error("The change failed");
      }),
    ).rejects.toThrow("The change failed");

    expect(await messagesOf(orderId)).toHaveLength(before.length);
  });

  it("queues nothing for a move that loses a race", async () => {
    const orderId = await staffOrder();
    await moveStage(orderId, "RECEIVED_BY_STORE", "IN_PROGRESS");
    request.headers = staff.headers;
    // The page still showed Received by store: the move is refused.
    expect(await changeOrderStage({ orderId, from: "RECEIVED_BY_STORE", to: "IN_PROGRESS" })).toMatchObject({ ok: false });
    await prisma.order.update({ where: { id: orderId }, data: { stage: "IN_PROGRESS" } });
    expect((await messagesOf(orderId)).map((message) => message.template)).toEqual(["LINK_CREATED"]);
  });
});

// ───────────── Channels ─────────────

describe("channels", () => {
  it("sends each of the four messages by email too, for a customer with an email", async () => {
    const email = newEmail();
    const phone = nigerianPhone();
    const orderId = await staffOrder({ customer: { phone, email }, quoteRequired: true });
    await issuePriceUpdate(orderId);
    await prisma.order.update({ where: { id: orderId }, data: { stage: "IN_PROGRESS" } });
    await prisma.quoteRevision.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "SUPERSEDED" } });
    await moveStage(orderId, "IN_PROGRESS", "READY");

    const pickupEmail = newEmail();
    const pickup = await staffPickupOrder({ email: pickupEmail });
    await prisma.order.update({ where: { id: pickup }, data: { stage: "READY" } });
    await moveStage(pickup, "READY", "OUT_FOR_DELIVERY");

    const emails = (await messagesOf(orderId)).filter((message) => message.channel === "EMAIL");
    expect(emails.map((message) => [message.template, message.recipient, message.status])).toEqual([
      ["LINK_CREATED", email, "SENT"],
      ["QUOTE_NEEDS_APPROVAL", email, "SENT"],
      ["READY", email, "SENT"],
    ]);
    expect((await messagesOf(pickup)).filter((message) => message.channel === "EMAIL").map((message) => message.template)).toEqual([
      "LINK_CREATED",
      "OUT_FOR_DELIVERY",
    ]);

    const sent = fakeMailer.sent.filter((message) => message.to === email);
    expect(sent.map((message) => message.subject)).toEqual([
      expect.stringMatching(/^Notify Test Laundry: we've received your order NT-\d+$/),
      expect.stringMatching(/^Notify Test Laundry: please review the price of order NT-\d+$/),
      expect.stringMatching(/^Notify Test Laundry: your order NT-\d+ is ready$/),
    ]);
    expect(sent[0].text).toMatch(/^Hi Ada,\n\nWe've received your order NT-\d+\./);
    expect(sent[0].text).toMatch(/Track your order: http/);
    expect(sent[0].html).toContain("Track your order");
  });

  it("sends a foreign number no SMS, but still the email", async () => {
    const phone = ukPhone();
    const email = newEmail();
    const orderId = await staffOrder({ customer: { phone, email } });

    expect((await messagesOf(orderId)).map((message) => [message.channel, message.recipient])).toEqual([["EMAIL", email]]);
    expect(fakeSms.sentTo(phone)).toHaveLength(0);
  });

  it("sends a Nigerian number the email when the store's SMS is off", async () => {
    await prisma.store.update({ where: { id: main.id }, data: { smsEnabled: false } });
    const email = newEmail();
    const orderId = await staffOrder({ customer: { email } });

    expect((await messagesOf(orderId)).map((message) => message.channel)).toEqual(["EMAIL"]);
    expect(fakeSms.sent).toHaveLength(0);
  });

  it("stops each channel for new messages when its setting is turned off", async () => {
    request.headers = owner.headers;
    expect(await setCommunicationSetting("emailCopiesEnabled", false)).toMatchObject({ ok: true });
    const withEmail = await staffOrder({ customer: { email: newEmail() } });
    expect((await messagesOf(withEmail)).map((message) => message.channel)).toEqual(["SMS"]);

    request.headers = owner.headers;
    expect(await setCommunicationSetting("smsEnabled", false)).toMatchObject({ ok: true });
    expect(await messagesOf(await staffOrder())).toHaveLength(0);

    request.headers = owner.headers;
    expect(await setCommunicationSetting("whatsappContactEnabled", false)).toMatchObject({ ok: true });
    request.headers = staff.headers;
    expect(await openWhatsApp({ orderId: withEmail, withLink: false })).toEqual({ ok: false, message: "WhatsApp is turned off in Settings." });
  });

  it("lets only the owner change the settings", async () => {
    request.headers = staff.headers;
    expect(await setCommunicationSetting("smsEnabled", false)).toMatchObject({ ok: false });
    expect(await prisma.store.findUniqueOrThrow({ where: { id: main.id }, select: { smsEnabled: true } })).toEqual({ smsEnabled: true });
  });

  it("still sends a message queued before the setting was turned off", async () => {
    const orderId = await staffOrder();
    fakeSms.failSends = true;
    await moveStage(orderId, "RECEIVED_BY_STORE", "IN_PROGRESS");
    await moveStage(orderId, "IN_PROGRESS", "READY");
    await prisma.store.update({ where: { id: main.id }, data: { smsEnabled: false } });
    fakeSms.failSends = false;

    await runCron();
    expect((await messagesOf(orderId)).at(-1)).toMatchObject({ template: "READY", status: "SENT", attempts: 2 });
  });
});

// ───────────── The daily booking SMS cap ─────────────

describe("the daily booking SMS cap", () => {
  beforeEach(async () => {
    await prisma.messageEvent.deleteMany({ where: { storeId: capped.id } });
  });

  // Earlier booking SMS today, inserted directly against one order.
  async function insertBookingSms(count: number) {
    const { orderId } = await book(capped, { phone: ukPhone() });
    await prisma.messageEvent.createMany({
      data: Array.from({ length: count }, () => ({
        storeId: capped.id,
        orderId,
        channel: "SMS" as const,
        template: "LINK_CREATED",
        recipient: "+2348030000000",
        status: "SENT" as const,
        createdAt: new Date(),
      })),
    });
  }

  it("counts only online-booking order link SMS, never staff messages or Send again", async () => {
    await book(capped);
    expect(await bookingSmsToday(capped.id)).toBe(1);

    const staffOrderId = await staffOrder({ store: capped });
    request.headers = capStaff.headers;
    expect(await sendLinkBySms({ orderId: staffOrderId })).toMatchObject({ ok: true });
    expect(await bookingSmsToday(capped.id)).toBe(1);

    // Send again on a booking SMS that finally failed.
    fakeSms.failSends = true;
    const { orderId } = await book(capped);
    const [failed] = await messagesOf(orderId);
    await prisma.messageEvent.update({ where: { id: failed.id }, data: { attempts: 3, body: null } });
    fakeSms.failSends = false;
    expect(await bookingSmsToday(capped.id)).toBe(2);
    request.headers = capStaff.headers;
    expect(await resendMessage({ orderId, messageId: failed.id })).toMatchObject({ ok: true });
    expect(await bookingSmsToday(capped.id)).toBe(2);
    expect((await messagesOf(orderId)).at(-1)).toMatchObject({ status: "SENT", createdByUserId: capStaff.id });
  });

  it("queues no SMS for the 101st booking of the day, and the booking still succeeds", async () => {
    await insertBookingSms(100);
    const phone = nigerianPhone();
    const { orderId, trackingUrl } = await book(capped, { phone });

    expect(trackingUrl).not.toBeNull();
    expect(await messagesOf(orderId)).toHaveLength(0);
    expect(fakeSms.sentTo(phone)).toHaveLength(0);
    expect(fakeMailer.sent).toHaveLength(0);
  });

  it("still sends the email copy past the cap", async () => {
    await insertBookingSms(100);
    const email = newEmail();
    const { orderId } = await book(capped, { email });
    expect((await messagesOf(orderId)).map((message) => message.channel)).toEqual(["EMAIL"]);
  });

  it("sends Fluta one alert at 80% of the cap", async () => {
    await insertBookingSms(78);
    await book(capped);
    expect(fakeMailer.sent).toHaveLength(0);

    await book(capped);
    const alertTo = getServerEnv().FLUTA_ALERT_EMAIL;
    expect(fakeMailer.sent.filter((message) => message.to === alertTo)).toEqual([
      expect.objectContaining({ subject: "Cap Test Laundry: 80% of today's booking SMS used" }),
    ]);

    await book(capped);
    expect(fakeMailer.sent.filter((message) => message.to === alertTo)).toHaveLength(1);
  });
});

// ───────────── Sending ─────────────

describe("sending", () => {
  // A message queued but not yet sent.
  async function queuedReady(customer: Customer = {}) {
    const orderId = await staffOrder({ customer });
    const queued = await queueMessagesForOrder(main.id, orderId, customerMessages({ template: "READY", createdByUserId: staff.id }), new Date());
    if (!queued) throw new Error("No order");
    const sms = (await messagesOf(orderId)).find((message) => message.id === queued.ids[0]);
    if (!sms) throw new Error("Nothing queued");
    return { orderId, message: sms };
  }

  it("clears the body once a message is sent", async () => {
    const { message } = await queuedReady();
    expect(message.body).toContain("is ready for collection");
    expect(await sendMessage(main.id, message.id)).toBe("SENT");
    expect(await prisma.messageEvent.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ status: "SENT", body: null });
  });

  it("uses up an attempt with each claim, and never claims a message with 3 used", async () => {
    const { message } = await queuedReady();
    const now = new Date();
    expect(await claimMessage(main.id, message.id, now)).toMatchObject({ id: message.id, attempts: 1 });
    expect(await prisma.messageEvent.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
      status: "SENDING",
      attempts: 1,
      lastAttemptAt: now,
    });

    // SENDING less than 10 minutes: not claimed again. Stuck longer: claimed.
    expect(await claimMessage(main.id, message.id, new Date(now.getTime() + 5 * 60_000))).toBeNull();
    expect(await claimMessage(main.id, message.id, new Date(now.getTime() + 11 * 60_000))).toMatchObject({ attempts: 2 });

    await prisma.messageEvent.update({ where: { id: message.id }, data: { status: "FAILED", attempts: 3 } });
    expect(await claimMessage(main.id, message.id, new Date(now.getTime() + HOUR))).toBeNull();
  });

  it("sends a message once when two senders claim it at the same time", async () => {
    const phone = nigerianPhone();
    const { message } = await queuedReady({ phone });
    fakeSms.reset();

    const outcomes = await Promise.all([sendMessage(main.id, message.id), sendMessage(main.id, message.id)]);
    expect(outcomes.sort()).toEqual(["NOT_CLAIMED", "SENT"]);
    expect(fakeSms.sentTo(phone)).toHaveLength(1);
  });

  it("ends FAILED with its body cleared after 3 failed attempts, and the order shows SMS not sent", async () => {
    fakeSms.failSends = true;
    const orderId = await staffOrder();
    const [message] = await messagesOf(orderId);
    expect(message).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(message.body).not.toBeNull();

    await sendMessage(main.id, message.id);
    await runCron();
    const failed = await prisma.messageEvent.findUniqueOrThrow({ where: { id: message.id } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 3, body: null, lastError: "Error" });

    // The job never tries it again.
    fakeSms.failSends = false;
    await runCron();
    expect(await prisma.messageEvent.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ attempts: 3 });

    const detail = await getOrderDetail(main.id, orderId, "STAFF");
    const shown = detail?.order.messageEvents.find((event) => event.id === message.id);
    expect(shown && describeMessageStatus(shown).label).toBe("SMS not sent");
  });

  it("sends a finally failed message again with a fresh link", async () => {
    const phone = nigerianPhone();
    fakeSms.failSends = true;
    const orderId = await staffOrder({ customer: { phone } });
    const [message] = await messagesOf(orderId);
    await prisma.messageEvent.update({ where: { id: message.id }, data: { attempts: 3, body: null } });
    fakeSms.failSends = false;

    request.headers = staff.headers;
    expect(await resendMessage({ orderId, messageId: message.id })).toMatchObject({ ok: true });
    const resent = fakeSms.sentTo(phone).at(-1)?.text ?? "";
    expect(await loadTrackingPage(tokenIn(resent))).toMatchObject({ kind: "VALID" });
    expect((await messagesOf(orderId)).at(-1)).toMatchObject({ template: "LINK_CREATED", status: "SENT" });
  });

  it("refuses Send again for a message that was sent", async () => {
    const orderId = await staffOrder();
    const [message] = await messagesOf(orderId);
    request.headers = staff.headers;
    expect(await resendMessage({ orderId, messageId: message.id })).toMatchObject({ ok: false });
  });
});

// ───────────── Replaced links ─────────────

describe("replaced links", () => {
  it("replaces unsent link messages, SMS and email, when a newer link is issued", async () => {
    const email = newEmail();
    const orderId = await staffOrder({ customer: { email } });
    const queued = await queueMessagesForOrder(
      main.id,
      orderId,
      customerMessages({ template: "LINK_CREATED", createdByUserId: staff.id, link: { token: "a".repeat(43), stored: false } }),
      new Date(),
    );
    expect(queued?.ids).toHaveLength(2);

    request.headers = staff.headers;
    expect(await issueTrackingLink({ orderId })).toMatchObject({ ok: true });

    const replaced = (await messagesOf(orderId)).filter((message) => queued?.ids.includes(message.id));
    expect(replaced.map((message) => [message.channel, message.status, message.body])).toEqual([
      ["SMS", "REPLACED", null],
      ["EMAIL", "REPLACED", null],
    ]);
    expect(describeMessageStatus(replaced[0]).label).toBe("Replaced by a newer message");

    fakeSms.reset();
    fakeMailer.reset();
    await runCron();
    expect(await prisma.messageEvent.count({ where: { id: { in: queued?.ids }, status: "REPLACED" } })).toBe(2);
    expect(fakeSms.sent.filter((message) => message.text.includes("a".repeat(43)))).toHaveLength(0);
  });

  it("shows the may-have-been-replaced page for an unknown or replaced link", async () => {
    const { trackingUrl } = await book(main);
    const oldToken = tokenIn(trackingUrl ?? "");
    const orderId = (await prisma.order.findFirstOrThrow({ where: { trackingTokenHash: hashToken(oldToken) }, select: { id: true } })).id;
    request.headers = staff.headers;
    await issueTrackingLink({ orderId });

    expect(await loadTrackingPage(oldToken)).toEqual({ kind: "NOT_FOUND" });
    const page = renderToStaticMarkup(TrackingNotFound());
    expect(page).toContain(TRACKING_MESSAGES.invalid.replaceAll("'", "&#x27;"));
    expect(TRACKING_MESSAGES.invalid).toBe(
      "This link may have been replaced by a newer message from the store. Please open the latest message, or call the store.",
    );
  });
});

// ───────────── Manual WhatsApp ─────────────

describe("manual WhatsApp", () => {
  it("sends a link with a fresh token and records it as opened, with no body", async () => {
    const phone = nigerianPhone();
    const orderId = await staffOrder({ customer: { phone } });
    const firstToken = tokenIn(fakeSms.sentTo(phone)[0].text);

    request.headers = staff.headers;
    const result = await openWhatsApp({ orderId, withLink: true });
    if (!result.ok) throw new Error(result.message);

    const url = new URL(result.url);
    expect(url.origin + url.pathname).toBe(`https://wa.me/${phone.slice(1)}`);
    const text = url.searchParams.get("text") ?? "";
    expect(text).toMatch(/^Hello Ada Obi, this is Notify Test Laundry about your order NT-\d+\. You can follow your order here: http/);
    expect(await loadTrackingPage(firstToken)).toEqual({ kind: "NOT_FOUND" });
    expect(await loadTrackingPage(tokenIn(text))).toMatchObject({ kind: "VALID" });

    expect((await messagesOf(orderId)).at(-1)).toMatchObject({
      channel: "WHATSAPP_MANUAL",
      template: "WHATSAPP_LINK",
      status: "OPENED",
      body: null,
      recipient: phone,
      createdByUserId: staff.id,
    });
  });

  it("opens a message with no link for any country's number", async () => {
    const phone = ukPhone();
    const orderId = await staffOrder({ customer: { phone } });
    request.headers = staff.headers;
    const result = await openWhatsApp({ orderId, withLink: false });
    if (!result.ok) throw new Error(result.message);
    expect(new URL(result.url).searchParams.get("text")).toMatch(/^Hello Ada Obi, this is Notify Test Laundry about your order NT-\d+\.$/);
    expect((await messagesOf(orderId)).at(-1)).toMatchObject({ template: "WHATSAPP_MESSAGE", status: "OPENED", body: null });
  });
});

// ───────────── The scheduled job ─────────────

async function runCron(headers: HeadersInit = { authorization: `Bearer ${getServerEnv().CRON_SECRET}` }) {
  return runCronJob(new Request("http://localhost/api/cron/messages", { headers }));
}

describe("the scheduled job", () => {
  it("refuses requests without the right secret, including from a signed-in user", async () => {
    const wrong = [
      {},
      { authorization: "Bearer not-the-secret" },
      { authorization: getServerEnv().CRON_SECRET },
      Object.fromEntries(staff.headers.entries()),
    ];
    for (const headers of wrong) {
      const response = await runCron(headers);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false });
    }
    expect((await runCron()).status).toBe(200);
  });

  it("clears booking IP hashes older than 24 hours", async () => {
    const { orderId: old } = await book(main);
    const { orderId: recent } = await book(main);
    await prisma.order.update({ where: { id: old }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });

    expect((await runCron()).status).toBe(200);
    const orders = await prisma.order.findMany({ where: { id: { in: [old, recent] } }, select: { id: true, bookingIpHash: true } });
    expect(orders.find((order) => order.id === old)?.bookingIpHash).toBeNull();
    expect(orders.find((order) => order.id === recent)?.bookingIpHash).not.toBeNull();
  });
});
