import "server-only";

import type {
  ActorType,
  FulfilmentType,
  OrderChannel,
  OrderLineType,
  OrderStage,
  PickupWindowStatus,
  PricingType,
  Prisma,
} from "@/generated/prisma/client";

import { getPrisma } from "./client";
import { upsertCustomerByPhone, type NewCustomerData } from "./customers";

// A store's orders. storeId always comes from the caller's membership, never
// from the request, and is part of every where clause: an order ID from
// another store matches nothing.

// Neon round trips are slow from here; the order transaction makes several.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

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
  trackingTokenHash: string;
  internalNote: string | null;
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
  now: Date;
}

export interface CreatedOrder {
  id: string;
  orderNumber: number;
  orderPrefix: string;
}

// Creates the order and everything that goes with it in one transaction:
// the number from Store.nextOrderNumber, the customer (found or created by
// phone), the order, its lines, version 1, and the first status event. If
// anything fails, nothing is kept and no number is used up.
//
// Throws Prisma's unique-constraint error (P2002) when the store already has
// an order with this clientRequestId; the caller returns that order instead.
export async function insertOrder(storeId: string, data: NewOrderData): Promise<CreatedOrder> {
  return getPrisma().$transaction(async (tx) => {
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
        trackingTokenHash: data.trackingTokenHash,
        trackingTokenIssuedAt: data.now,
        internalNote: data.internalNote,
        createdByUserId: data.actor.userId,
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
    return { id, orderNumber, orderPrefix };
  }, TRANSACTION_OPTIONS);
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

// Staff agree the window with the customer, so the requested and scheduled
// windows are the same.
function pickupFields(pickup: NewOrderData["pickup"]) {
  if (!pickup) return {};
  return {
    requestedPickupDate: pickup.date,
    requestedWindowStart: pickup.windowStart,
    requestedWindowEnd: pickup.windowEnd,
    scheduledPickupDate: pickup.date,
    scheduledWindowStart: pickup.windowStart,
    scheduledWindowEnd: pickup.windowEnd,
    pickupWindowStatus: pickup.status,
  };
}

export async function findOrderByClientRequestId(storeId: string, clientRequestId: string): Promise<CreatedOrder | null> {
  const order = await getPrisma().order.findUnique({
    where: { storeId_clientRequestId: { storeId, clientRequestId } },
    select: { id: true, orderNumber: true, store: { select: { orderPrefix: true } } },
  });
  return order && { id: order.id, orderNumber: order.orderNumber, orderPrefix: order.store.orderPrefix };
}

// What the order summary page shows.
export async function findOrderSummary(storeId: string, orderId: string) {
  return getPrisma().order.findUnique({
    where: { storeId_id: { storeId, id: orderId } },
    select: {
      id: true,
      orderNumber: true,
      channel: true,
      fulfilmentType: true,
      stage: true,
      serviceAreaName: true,
      isOutOfArea: true,
      isOutsideSchedule: true,
      fulfilmentCharge: true,
      addressText: true,
      scheduledPickupDate: true,
      scheduledWindowStart: true,
      scheduledWindowEnd: true,
      internalNote: true,
      createdAt: true,
      store: { select: { orderPrefix: true } },
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
      approvedQuote: { select: { version: true, total: true } },
      quoteRevisions: { where: { version: 1 }, select: { total: true, status: true } },
    },
  });
}

export type OrderSummaryRecord = NonNullable<Awaited<ReturnType<typeof findOrderSummary>>>;
