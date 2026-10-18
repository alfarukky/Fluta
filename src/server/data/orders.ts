import "server-only";

import {
  Prisma,
  type ActorType,
  type FulfilmentType,
  type OrderChannel,
  type OrderLineType,
  type OrderStage,
  type PickupWindowStatus,
  type PricingType,
} from "@/generated/prisma/client";
import type { Coordinates } from "@/lib/location";
import { CLOSED_STAGES, type PaymentState } from "@/lib/orders";
import {
  IP_BOOKING_WINDOW_MS,
  IP_HASH_RETENTION_MS,
  isBookingLimitReached,
  PHONE_BOOKING_WINDOW_MS,
} from "@/server/domain/booking-limits";
import type { OrderListQuery } from "@/types/orders";

import { getPrisma } from "./client";
import { upsertCustomerByPhone, type NewCustomerData } from "./customers";
import { queueOrderMessages, type MessageRequest, type QueuedMessages } from "./messages";

// A store's orders. storeId always comes from the caller's membership, never
// from the request, and is part of every where clause: an order ID from
// another store matches nothing.

// Neon round trips are slow from here; the order transaction makes several.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };
// Online bookings from one phone or IP wait their turn (see insertOnlineOrder),
// so the transaction may spend a while waiting before it starts its work.
const ONLINE_TRANSACTION_OPTIONS = { maxWait: 20_000, timeout: 40_000 };

export interface NewOrderLineData {
  lineType: OrderLineType;
  serviceId: string | null;
  description: string;
  pricingType: PricingType | null;
  requiresQuote: boolean;
  unitPrice: number | null;
  estimatedQuantity: string | null; // Decimal, e.g. "2.50"
  quantity: string | null;
  lineTotal: number | null;
}

export interface NewOrderData {
  clientRequestId: string;
  // A "new" customer is found or created by phone (upsertCustomerByPhone).
  customer: { kind: "existing"; customerId: string } | ({ kind: "new" } & NewCustomerData);
  channel: OrderChannel;
  fulfilmentType: FulfilmentType;
  stage: OrderStage;
  serviceAreaId: string | null;
  serviceAreaName: string | null;
  isOutOfArea: boolean;
  isOutsideSchedule: boolean;
  fulfilmentCharge: number | null;
  addressText: string | null;
  pickup: { date: Date; windowStart: string; windowEnd: string; status: PickupWindowStatus } | null;
  // Online pickups only: the customer's shared location, already checked and
  // rounded (src/lib/location.ts). Only for "Open in Maps".
  pickupLocation: Coordinates | null;
  trackingTokenHash: string;
  internalNote: string | null;
  // Online bookings only: the customer's "Anything else?" note. Never priced.
  customerNote: string | null;
  payLater: boolean;
  // Online bookings only: the HMAC of the booking's IP address (booking limits).
  bookingIpHash: string | null;
  lines: NewOrderLineData[];
  // Version 1 of the quote revision; approved at once when fully priced.
  revision: {
    linesSnapshot: Prisma.InputJsonValue;
    itemsSubtotal: number;
    fulfilmentCharge: number;
    total: number;
    approved: boolean;
  };
  actor: { type: ActorType; userId: string | null };
  // The order link message, queued with the order.
  messages: MessageRequest | null;
  now: Date;
}

export interface CreatedOrder {
  id: string;
  orderNumber: number;
  orderPrefix: string;
  // Messages queued with a newly created order, to send after the commit.
  queued?: QueuedMessages | null;
}

// Creates the order and everything that goes with it in one transaction:
// the number from Store.nextOrderNumber, the customer (found or created by
// phone), the order, its lines, version 1, the first status event, and the
// queued order link message. If
// anything fails, nothing is kept and no number is used up.
//
// Throws Prisma's unique-constraint error (P2002) when the store already has
// an order with this clientRequestId; the caller returns that order instead.
export async function insertOrder(storeId: string, data: NewOrderData): Promise<CreatedOrder> {
  return getPrisma().$transaction((tx) => createOrderRecords(tx, storeId, data), TRANSACTION_OPTIONS);
}

export type OnlineOrderInsert =
  | { kind: "created" | "existing"; order: CreatedOrder }
  | { kind: "limitReached" };

// An online booking: insertOrder's transaction, after the booking checks, in
// this order. First, an order already created by this request ID is returned
// as it is. Then the booking limits: this phone's online bookings at this store
// in 24 hours, and this IP's at any store in an hour. Then the order.
//
// Before counting, the transaction takes two locks held until it ends: one for
// this store and phone number, one for this IP hash. Bookings from the same
// phone or IP are counted one at a time, so simultaneous ones can't slip past
// a limit, and different customers never wait on each other. The phone lock
// comes first in every booking, so two bookings can't each hold the lock the
// other is waiting for.
//
// It also clears the IP hash of this store's orders older than 24 hours.
export async function insertOnlineOrder(storeId: string, data: NewOrderData): Promise<OnlineOrderInsert> {
  if (data.customer.kind !== "new" || data.bookingIpHash === null) {
    throw new Error("An online booking needs the customer's phone number and the IP hash.");
  }
  const { phone } = data.customer;
  const ipHash = data.bookingIpHash;

  return getPrisma().$transaction(async (tx) => {
    await lockKeys(tx, `booking:phone:${storeId}:${phone}`, `booking:ip:${ipHash}`);

    const existing = await tx.order.findUnique({
      where: { storeId_clientRequestId: { storeId, clientRequestId: data.clientRequestId } },
      select: { id: true, orderNumber: true, store: { select: { orderPrefix: true } } },
    });
    if (existing) {
      return {
        kind: "existing",
        order: { id: existing.id, orderNumber: existing.orderNumber, orderPrefix: existing.store.orderPrefix },
      };
    }

    const now = data.now.getTime();
    const phoneCount = await tx.order.count({
      where: {
        storeId,
        channel: "ONLINE",
        customer: { phone },
        createdAt: { gt: new Date(now - PHONE_BOOKING_WINDOW_MS) },
      },
    });
    const ipCount = await tx.order.count({
      where: { bookingIpHash: ipHash, createdAt: { gt: new Date(now - IP_BOOKING_WINDOW_MS) } },
    });
    if (isBookingLimitReached({ phone: phoneCount, ip: ipCount })) return { kind: "limitReached" };

    await tx.order.updateMany({
      where: { storeId, bookingIpHash: { not: null }, createdAt: { lt: new Date(now - IP_HASH_RETENTION_MS) } },
      data: { bookingIpHash: null },
    });

    return { kind: "created", order: await createOrderRecords(tx, storeId, data) };
  }, ONLINE_TRANSACTION_OPTIONS);
}

// Locks on both keys until the transaction ends (pg_advisory_xact_lock), the
// first before the second, in one round trip.
async function lockKeys(tx: Prisma.TransactionClient, first: string, second: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${first}, 0)), pg_advisory_xact_lock(hashtextextended(${second}, 0))`;
}

async function createOrderRecords(tx: Prisma.TransactionClient, storeId: string, data: NewOrderData): Promise<CreatedOrder> {
  // Allocated first: the row lock it takes on the store queues other order
  // creations for this store until this transaction ends.
  const { orderNumber, orderPrefix } = await allocateOrderNumber(tx, storeId);
  const customerId =
    data.customer.kind === "existing"
      ? data.customer.customerId
      : (await upsertCustomerByPhone(tx, storeId, data.customer)).id;

  const { id } = await tx.order.create({
    data: {
      storeId,
      orderNumber,
      customerId,
      clientRequestId: data.clientRequestId,
      channel: data.channel,
      fulfilmentType: data.fulfilmentType,
      stage: data.stage,
      serviceAreaId: data.serviceAreaId,
      serviceAreaName: data.serviceAreaName,
      isOutOfArea: data.isOutOfArea,
      isOutsideSchedule: data.isOutsideSchedule,
      fulfilmentCharge: data.fulfilmentCharge,
      addressText: data.addressText,
      ...pickupFields(data.pickup),
      pickupLatitude: data.pickupLocation?.latitude.toFixed(6) ?? null,
      pickupLongitude: data.pickupLocation?.longitude.toFixed(6) ?? null,
      payLater: data.payLater,
      trackingTokenHash: data.trackingTokenHash,
      trackingTokenIssuedAt: data.now,
      internalNote: data.internalNote,
      customerNote: data.customerNote,
      createdByUserId: data.actor.userId,
      bookingIpHash: data.bookingIpHash,
      createdAt: data.now,
    },
    select: { id: true },
  });

  await tx.orderLine.createMany({ data: data.lines.map((line) => ({ ...line, storeId, orderId: id })) });

  const { approved, ...amounts } = data.revision;
  const revision = await tx.quoteRevision.create({
    data: {
      storeId,
      orderId: id,
      version: 1,
      ...amounts,
      status: approved ? "APPROVED" : "PENDING",
      createdByActor: data.actor.type,
      createdByUserId: data.actor.userId,
      createdAt: data.now,
      approvedAt: approved ? data.now : null,
      approvedByActor: approved ? data.actor.type : null,
    },
    select: { id: true },
  });
  if (approved) {
    await tx.order.update({ where: { storeId_id: { storeId, id } }, data: { approvedQuoteId: revision.id } });
  }

  await tx.statusEvent.create({
    data: {
      storeId,
      orderId: id,
      fromStage: null,
      toStage: data.stage,
      actorType: data.actor.type,
      actorUserId: data.actor.userId,
      createdAt: data.now,
    },
  });
  const queued = data.messages ? await queueOrderMessages(tx, storeId, id, data.messages, data.now) : null;
  return { id, orderNumber, orderPrefix, queued };
}

// One UPDATE … RETURNING: the row lock serialises concurrent allocations, and
// @@unique([storeId, orderNumber]) backs it up.
async function allocateOrderNumber(
  tx: Prisma.TransactionClient,
  storeId: string,
): Promise<{ orderNumber: number; orderPrefix: string }> {
  const { nextOrderNumber, orderPrefix } = await tx.store.update({
    where: { id: storeId },
    data: { nextOrderNumber: { increment: 1 } },
    select: { nextOrderNumber: true, orderPrefix: true },
  });
  return { orderNumber: nextOrderNumber - 1, orderPrefix };
}

// Staff agree the window with the customer (CONFIRMED), so the requested and
// scheduled windows are the same. An online booking only requests one
// (REQUESTED): staff confirm or propose a window later (Feature 14).
function pickupFields(pickup: NewOrderData["pickup"]) {
  if (!pickup) return {};
  const requested = {
    requestedPickupDate: pickup.date,
    requestedWindowStart: pickup.windowStart,
    requestedWindowEnd: pickup.windowEnd,
    pickupWindowStatus: pickup.status,
  };
  if (pickup.status !== "CONFIRMED") return requested;
  return {
    ...requested,
    scheduledPickupDate: pickup.date,
    scheduledWindowStart: pickup.windowStart,
    scheduledWindowEnd: pickup.windowEnd,
  };
}

export async function findOrderByClientRequestId(storeId: string, clientRequestId: string): Promise<CreatedOrder | null> {
  const order = await getPrisma().order.findUnique({
    where: { storeId_clientRequestId: { storeId, clientRequestId } },
    select: { id: true, orderNumber: true, store: { select: { orderPrefix: true } } },
  });
  return order && { id: order.id, orderNumber: order.orderNumber, orderPrefix: order.store.orderPrefix };
}

// Whether the order is this store's: checked before the detail page starts
// streaming, so a missing order (or another store's) gets a real 404.
export async function orderExists(storeId: string, orderId: string): Promise<boolean> {
  const order = await getPrisma().order.findUnique({ where: { storeId_id: { storeId, id: orderId } }, select: { id: true } });
  return order !== null;
}

// ───────────── Orders list ─────────────

const LIST_ROW_SELECT = {
  id: true,
  orderNumber: true,
  stage: true,
  fulfilmentType: true,
  isOutOfArea: true,
  scheduledPickupDate: true,
  scheduledWindowStart: true,
  scheduledWindowEnd: true,
  requestedPickupDate: true,
  requestedWindowStart: true,
  requestedWindowEnd: true,
  createdAt: true,
  customer: { select: { name: true } },
  lines: {
    where: { lineType: "SERVICE" },
    select: { description: true, pricingType: true, quantity: true },
    orderBy: { id: "asc" },
  },
  approvedQuote: { select: { total: true } },
  payments: { select: { amount: true, status: true, voidedAt: true } },
  refunds: { select: { amount: true, voidedAt: true } },
} as const satisfies Prisma.OrderSelect;

export type OrderListRecord = Prisma.OrderGetPayload<{ select: typeof LIST_ROW_SELECT }>;

// One page of the store's orders, newest first, and whether more follow.
// Two steps, each a fixed number of queries whatever the page size: one SQL
// query picks the page's IDs (search, filters, and cursor), then Prisma loads
// those orders with their lines, quote, payments, and refunds.
export async function listOrders(
  storeId: string,
  query: OrderListQuery,
  pageSize: number,
): Promise<{ orders: OrderListRecord[]; hasMore: boolean }> {
  const ids = await findOrderPageIds(storeId, query, pageSize + 1);
  const hasMore = ids.length > pageSize;
  const pageIds = ids.slice(0, pageSize);
  if (pageIds.length === 0) return { orders: [], hasMore: false };

  const records = await getPrisma().order.findMany({
    where: { storeId, id: { in: pageIds } },
    select: LIST_ROW_SELECT,
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  return { orders: pageIds.flatMap((id) => byId.get(id) ?? []), hasMore };
}

async function findOrderPageIds(storeId: string, query: OrderListQuery, limit: number): Promise<string[]> {
  const conditions: Prisma.Sql[] = [Prisma.sql`o."storeId" = ${storeId}`];

  if (query.search) {
    const { orderNumber, phoneDigits, name } = query.search;
    const matches = [Prisma.sql`c."name" ILIKE ${`%${escapeLike(name)}%`}`];
    if (orderNumber !== null) matches.push(Prisma.sql`o."orderNumber" = ${orderNumber}`);
    // Stored as E.164 ("+234…"), and the digits never hold a LIKE wildcard.
    if (phoneDigits !== null) matches.push(Prisma.sql`c."phone" LIKE ${`%${phoneDigits}%`}`);
    conditions.push(Prisma.sql`(${Prisma.join(matches, " OR ")})`);
  }
  if (query.stage) conditions.push(Prisma.sql`o."stage" = ${query.stage}::"OrderStage"`);
  if (query.fulfilmentType) {
    conditions.push(Prisma.sql`o."fulfilmentType" = ${query.fulfilmentType}::"FulfilmentType"`);
  }
  if (query.createdFrom) conditions.push(Prisma.sql`o."createdAt" >= ${query.createdFrom}`);
  if (query.after) {
    conditions.push(Prisma.sql`(o."createdAt", o."id") < (${query.after.createdAt}, ${query.after.id})`);
  }
  if (query.paymentState) conditions.push(paymentStateCondition(query.paymentState));

  const rows = await getPrisma().$queryRaw<{ id: string }[]>`
    SELECT o."id"
    FROM "Order" o
    JOIN "Customer" c ON c."storeId" = o."storeId" AND c."id" = o."customerId"
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY o."createdAt" DESC, o."id" DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => row.id);
}

// The payment-state filter: getBalance's rule (src/server/domain/balance.ts)
// written in SQL, used only to choose rows; every amount and badge shown still
// comes from getBalance. An integration test checks they agree on every order.
//   balance = approved total (0 if cancelled) − confirmed payments + refunds paid
function paymentStateCondition(state: PaymentState): Prisma.Sql {
  const approvedTotal = Prisma.sql`(
    CASE WHEN o."stage" = 'CANCELLED' THEN 0
    ELSE (SELECT q."total" FROM "QuoteRevision" q WHERE q."storeId" = o."storeId" AND q."id" = o."approvedQuoteId")
    END)`;
  const confirmedPayments = Prisma.sql`(
    SELECT COALESCE(SUM(p."amount"), 0) FROM "Payment" p
    WHERE p."storeId" = o."storeId" AND p."orderId" = o."id" AND p."status" = 'CONFIRMED' AND p."voidedAt" IS NULL)`;
  const paidRefunds = Prisma.sql`(
    SELECT COALESCE(SUM(r."amount"), 0) FROM "Refund" r
    WHERE r."storeId" = o."storeId" AND r."orderId" = o."id" AND r."voidedAt" IS NULL)`;
  const balance = Prisma.sql`(${approvedTotal} - ${confirmedPayments} + ${paidRefunds})`;

  switch (state) {
    case "AWAITING_QUOTE":
      return Prisma.sql`(o."stage" <> 'CANCELLED' AND o."approvedQuoteId" IS NULL)`;
    case "PAID":
      return Prisma.sql`(o."stage" <> 'CANCELLED' AND ${balance} = 0)`;
    case "NOTHING_DUE":
      return Prisma.sql`(o."stage" = 'CANCELLED' AND ${balance} = 0)`;
    case "OUTSTANDING":
      return Prisma.sql`${balance} > 0`;
    case "REFUND_OWED":
      return Prisma.sql`${balance} < 0`;
  }
}

// Search text matched literally inside ILIKE: %, _, and \ lose their meaning.
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// Orders not yet Completed or Cancelled, for the sidebar.
export async function countOpenOrders(storeId: string): Promise<number> {
  return getPrisma().order.count({ where: { storeId, stage: { notIn: [...CLOSED_STAGES] } } });
}

// ───────────── Order detail ─────────────

// Everything the order detail page shows, from the order's own copies. A
// fixed number of queries: each relation loads in one query whatever its
// size. Staff names for the timeline come separately (findStaffNames).
export async function findOrderDetail(storeId: string, orderId: string) {
  return getPrisma().order.findUnique({
    where: { storeId_id: { storeId, id: orderId } },
    select: {
      id: true,
      orderNumber: true,
      channel: true,
      fulfilmentType: true,
      stage: true,
      stageBeforeQuote: true,
      approvedQuoteId: true,
      serviceAreaName: true,
      isOutOfArea: true,
      isOutsideSchedule: true,
      fulfilmentCharge: true,
      addressText: true,
      pickupLatitude: true,
      pickupLongitude: true,
      requestedPickupDate: true,
      requestedWindowStart: true,
      requestedWindowEnd: true,
      scheduledPickupDate: true,
      scheduledWindowStart: true,
      scheduledWindowEnd: true,
      pickupWindowStatus: true,
      internalNote: true,
      customerNote: true,
      completedAt: true,
      cancelledAt: true,
      createdAt: true,
      store: { select: { orderPrefix: true, smsEnabled: true, whatsappContactEnabled: true } },
      customer: { select: { name: true, phone: true, email: true } },
      lines: {
        select: {
          id: true,
          lineType: true,
          description: true,
          pricingType: true,
          requiresQuote: true,
          unitPrice: true,
          estimatedQuantity: true,
          quantity: true,
          lineTotal: true,
        },
        // Services first, then Others, each in the order they were entered.
        orderBy: [{ lineType: "asc" }, { id: "asc" }],
      },
      approvedQuote: { select: { id: true, version: true, total: true } },
      quoteRevisions: {
        select: {
          id: true,
          version: true,
          total: true,
          status: true,
          reason: true,
          customerMessage: true,
          createdAt: true,
          createdByUserId: true,
          approvedAt: true,
          approvedByActor: true,
          declinedAt: true,
        },
        orderBy: { version: "desc" },
      },
      payments: {
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          paystackReference: true,
          note: true,
          confirmedAt: true,
          voidedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
      refunds: {
        select: { id: true, amount: true, note: true, paidAt: true, voidedAt: true },
        orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      },
      statusEvents: {
        select: { id: true, fromStage: true, toStage: true, actorType: true, actorUserId: true, note: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
      // Never the body or recipient.
      messageEvents: {
        select: { id: true, channel: true, template: true, status: true, attempts: true, createdAt: true, sentAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });
}

export type OrderDetailRecord = NonNullable<Awaited<ReturnType<typeof findOrderDetail>>>;

// Names of this store's members (current or former) among `userIds`, in one
// query. IDs of anyone outside the store are ignored.
export async function findStaffNames(storeId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await getPrisma().user.findMany({
    where: { id: { in: [...new Set(userIds)] }, memberships: { some: { storeId } } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}
