import "server-only";

import { Prisma, type FulfilmentType, type MessageChannel } from "@/generated/prisma/client";
import { MAX_MESSAGE_ATTEMPTS, MESSAGE_TEMPLATES } from "@/lib/messages";
import { IP_HASH_RETENTION_MS } from "@/server/domain/booking-limits";
import { getCapDayStart, STUCK_SENDING_MS } from "@/server/domain/messages";

import { getPrisma } from "./client";
import { storeNewTrackingToken } from "./tracking";

// Customer messages. MessageEvent is the outbox: a message is queued in the
// same transaction as the change that triggers it, sent right after the
// commit, and retried by the scheduled job. Every function takes the
// message's or order's storeId and puts it in every where clause. The job
// works across stores, but only with the storeId and ID each due message
// carries, never with IDs from a request.
//
// A body may hold a raw tracking link, so it is cleared as soon as the
// message is sent, finally fails, or is replaced. Never log a body.

// Neon round trips are slow from here.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

// ───────────── Queuing (inside the trigger's transaction) ─────────────

// What a message plan is decided from, read inside the transaction.
export interface MessageContext {
  order: { id: string; orderNumber: number; fulfilmentType: FulfilmentType };
  store: {
    name: string;
    phone: string | null;
    orderPrefix: string;
    timeZone: string;
    smsEnabled: boolean;
    emailCopiesEnabled: boolean;
    dailyBookingSmsCap: number;
  };
  customer: { name: string; phone: string; email: string | null };
  // Order-link SMS from online bookings queued today (store time), when
  // the request asked for the count.
  bookingSmsToday: number | null;
}

export interface NewMessage {
  channel: "SMS" | "EMAIL";
  template: string;
  recipient: string;
  body: string;
}

export interface MessagePlan {
  messages: NewMessage[];
  // A fresh tracking token's hash to store with these messages (they carry
  // its link). The order's older link stops working, and any unsent message
  // holding it is replaced.
  newTokenHash: string | null;
  // These messages pass 80% of the daily booking SMS cap.
  capAlert: boolean;
}

export interface MessageRequest {
  // Count today's online-booking order-link SMS for the daily cap.
  countBookingSms: boolean;
  createdByUserId: string | null;
  plan: (context: MessageContext) => MessagePlan;
}

export interface QueuedMessages {
  storeId: string;
  ids: string[];
  capAlert: { storeName: string; cap: number } | null;
}

// Queues the request's messages for the order on the caller's transaction,
// and stores the plan's new token (replacing unsent messages that hold the
// older link) in that same transaction.
export async function queueOrderMessages(
  tx: Prisma.TransactionClient,
  storeId: string,
  orderId: string,
  request: MessageRequest,
  now: Date,
): Promise<QueuedMessages> {
  const context = await readMessageContext(tx, storeId, orderId);
  if (!context) throw new Error("Queuing messages for an order that doesn't exist.");
  if (request.countBookingSms) {
    context.bookingSmsToday = await countBookingSmsToday(tx, storeId, context.store.timeZone, now);
  }

  const plan = request.plan(context);
  if (plan.newTokenHash !== null) {
    await storeNewTrackingToken(tx, storeId, orderId, plan.newTokenHash, request.createdByUserId, now);
  }
  const created =
    plan.messages.length === 0
      ? []
      : await tx.messageEvent.createManyAndReturn({
          data: plan.messages.map((message) => ({
            storeId,
            orderId,
            ...message,
            status: "QUEUED" as const,
            createdByUserId: request.createdByUserId,
            createdAt: now,
          })),
          select: { id: true },
        });

  return {
    storeId,
    ids: created.map((message) => message.id),
    capAlert:
      plan.capAlert && created.length > 0 ? { storeName: context.store.name, cap: context.store.dailyBookingSmsCap } : null,
  };
}

// The same, in a transaction of its own (staff "Send link by SMS" and "Send
// again"). Null for an order that isn't this store's.
export async function queueMessagesForOrder(
  storeId: string,
  orderId: string,
  request: MessageRequest,
  now: Date,
): Promise<QueuedMessages | null> {
  return getPrisma().$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { storeId_id: { storeId, id: orderId } }, select: { id: true } });
    if (!order) return null;
    return queueOrderMessages(tx, storeId, orderId, request, now);
  }, TRANSACTION_OPTIONS);
}

// One query: the order, its store's settings, and its customer.
async function readMessageContext(tx: Prisma.TransactionClient, storeId: string, orderId: string): Promise<MessageContext | null> {
  const rows = await tx.$queryRaw<
    {
      orderNumber: number;
      fulfilmentType: FulfilmentType;
      storeName: string;
      storePhone: string | null;
      orderPrefix: string;
      timeZone: string;
      smsEnabled: boolean;
      emailCopiesEnabled: boolean;
      dailyBookingSmsCap: number;
      customerName: string;
      customerPhone: string;
      customerEmail: string | null;
    }[]
  >`
    SELECT o."orderNumber", o."fulfilmentType",
      s."name" AS "storeName", s."phone" AS "storePhone", s."orderPrefix", s."timeZone",
      s."smsEnabled", s."emailCopiesEnabled", s."dailyBookingSmsCap",
      c."name" AS "customerName", c."phone" AS "customerPhone", c."email" AS "customerEmail"
    FROM "Order" o
    JOIN "Store" s ON s."id" = o."storeId"
    JOIN "Customer" c ON c."storeId" = o."storeId" AND c."id" = o."customerId"
    WHERE o."storeId" = ${storeId} AND o."id" = ${orderId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    order: { id: orderId, orderNumber: row.orderNumber, fulfilmentType: row.fulfilmentType },
    store: {
      name: row.storeName,
      phone: row.storePhone,
      orderPrefix: row.orderPrefix,
      timeZone: row.timeZone,
      smsEnabled: row.smsEnabled,
      emailCopiesEnabled: row.emailCopiesEnabled,
      dailyBookingSmsCap: row.dailyBookingSmsCap,
    },
    customer: { name: row.customerName, phone: row.customerPhone, email: row.customerEmail },
    bookingSmsToday: null,
  };
}

// The daily cap counts only order-link SMS queued by online bookings: created
// with no staff user. Staff-triggered messages always have one.
async function countBookingSmsToday(tx: Prisma.TransactionClient, storeId: string, timeZone: string, now: Date): Promise<number> {
  return tx.messageEvent.count({
    where: {
      storeId,
      channel: "SMS",
      template: MESSAGE_TEMPLATES.orderLink,
      createdByUserId: null,
      createdAt: { gte: getCapDayStart(now, timeZone) },
    },
  });
}

// ───────────── Manual WhatsApp ─────────────

export interface WhatsAppOrder {
  orderNumber: number;
  orderPrefix: string;
  storeName: string;
  customerName: string;
  customerPhone: string;
}

// Records that staff opened WhatsApp (OPENED, no body: Fluta never knows
// whether it was sent), with a new link stored first when there is one.
// Null for an order that isn't this store's.
export async function recordWhatsAppOpened(
  storeId: string,
  orderId: string,
  input: { template: string; newTokenHash: string | null; actorUserId: string },
  now: Date,
): Promise<WhatsAppOrder | null> {
  return getPrisma().$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { storeId_id: { storeId, id: orderId } },
      select: { orderNumber: true, customerId: true },
    });
    if (!order) return null;
    const store = await tx.store.findUniqueOrThrow({ where: { id: storeId }, select: { name: true, orderPrefix: true } });
    const customer = await tx.customer.findUniqueOrThrow({
      where: { storeId_id: { storeId, id: order.customerId } },
      select: { name: true, phone: true },
    });

    if (input.newTokenHash !== null) {
      await storeNewTrackingToken(tx, storeId, orderId, input.newTokenHash, input.actorUserId, now);
    }
    await tx.messageEvent.create({
      data: {
        storeId,
        orderId,
        channel: "WHATSAPP_MANUAL",
        template: input.template,
        recipient: customer.phone,
        status: "OPENED",
        body: null,
        createdByUserId: input.actorUserId,
        createdAt: now,
      },
    });
    return {
      orderNumber: order.orderNumber,
      orderPrefix: store.orderPrefix,
      storeName: store.name,
      customerName: customer.name,
      customerPhone: customer.phone,
    };
  }, TRANSACTION_OPTIONS);
}

// ───────────── Sending ─────────────

export interface ClaimedMessage {
  id: string;
  storeId: string;
  channel: MessageChannel;
  template: string;
  recipient: string;
  body: string;
  attempts: number;
  storeName: string;
  orderNumber: number;
  orderPrefix: string;
}

// What may be claimed now (isClaimable in src/server/domain/messages.ts):
// attempts left, still holding its body, and QUEUED or FAILED, or SENDING
// for more than 10 minutes since its last claim.
function claimableWhere(now: Date): Prisma.MessageEventWhereInput {
  return {
    attempts: { lt: MAX_MESSAGE_ATTEMPTS },
    body: { not: null },
    channel: { in: ["SMS", "EMAIL"] },
    OR: [
      { status: { in: ["QUEUED", "FAILED"] } },
      {
        status: "SENDING",
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(now.getTime() - STUCK_SENDING_MS) } }],
      },
    ],
  };
}

// Claims the message for this sender in one conditional update, which also
// uses up an attempt. Of two senders claiming at once, exactly one gets it;
// the other gets null.
export async function claimMessage(storeId: string, id: string, now: Date): Promise<ClaimedMessage | null> {
  const prisma = getPrisma();
  const { count } = await prisma.messageEvent.updateMany({
    where: { storeId, id, ...claimableWhere(now) },
    data: { status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: now },
  });
  if (count === 0) return null;

  const message = await prisma.messageEvent.findUnique({
    where: { id, storeId },
    select: {
      id: true,
      storeId: true,
      channel: true,
      template: true,
      recipient: true,
      body: true,
      attempts: true,
      status: true,
      store: { select: { name: true, orderPrefix: true } },
      order: { select: { orderNumber: true } },
    },
  });
  // Replaced by a newer link in the meantime.
  if (!message || message.status !== "SENDING" || message.body === null) return null;
  return {
    id: message.id,
    storeId: message.storeId,
    channel: message.channel,
    template: message.template,
    recipient: message.recipient,
    body: message.body,
    attempts: message.attempts,
    storeName: message.store.name,
    orderNumber: message.order.orderNumber,
    orderPrefix: message.store.orderPrefix,
  };
}

// Accepted by the provider. The body goes.
export async function markMessageSent(storeId: string, id: string, providerMessageId: string | null, now: Date): Promise<void> {
  await getPrisma().messageEvent.updateMany({
    where: { storeId, id, status: "SENDING" },
    data: { status: "SENT", sentAt: now, providerMessageId, lastError: null, body: null },
  });
}

// A failed attempt. After the last one the body goes too. `error` is a short
// code, never the body, token, or recipient.
export async function markMessageFailed(storeId: string, id: string, error: string, final: boolean): Promise<void> {
  await getPrisma().messageEvent.updateMany({
    where: { storeId, id, status: "SENDING" },
    data: { status: "FAILED", lastError: error, ...(final && { body: null }) },
  });
}

// ───────────── The scheduled job ─────────────

// Messages due a send, oldest first.
export async function findDueMessages(now: Date, limit: number): Promise<{ storeId: string; id: string }[]> {
  return getPrisma().messageEvent.findMany({
    where: claimableWhere(now),
    select: { storeId: true, id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });
}

// A message stuck in SENDING on its last attempt will never be claimed
// again: it ends FAILED, and its body goes.
export async function failStuckMessages(now: Date): Promise<number> {
  const { count } = await getPrisma().messageEvent.updateMany({
    where: {
      status: "SENDING",
      attempts: { gte: MAX_MESSAGE_ATTEMPTS },
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(now.getTime() - STUCK_SENDING_MS) } }],
    },
    data: { status: "FAILED", lastError: "No response from the last attempt", body: null },
  });
  return count;
}

// Booking IP hashes are kept 24 hours (booking limits), across all stores.
export async function clearOldBookingIpHashes(now: Date): Promise<number> {
  const { count } = await getPrisma().order.updateMany({
    where: { bookingIpHash: { not: null }, createdAt: { lt: new Date(now.getTime() - IP_HASH_RETENTION_MS) } },
    data: { bookingIpHash: null },
  });
  return count;
}

// ───────────── Send again ─────────────

export async function findOrderMessage(storeId: string, orderId: string, messageId: string) {
  return getPrisma().messageEvent.findFirst({
    where: { storeId, orderId, id: messageId },
    select: { id: true, channel: true, template: true, status: true, attempts: true },
  });
}
