import { createHash } from "node:crypto";

import {
  ActorType,
  MessageChannel,
  MessageStatus,
  OrderChannel,
  OrderLineType,
  OrderStage,
  PaymentSource,
  PaymentStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";

import { hoursAfter, hoursBefore, lagosDate, lineTotalKobo, seedTrackingTokenHash } from "./helpers";
import type { SeedLine, SeedOrder, SeedRevision, SeedStoreContext } from "./types";

type Tx = Prisma.TransactionClient;

// QuoteRevision.createdByUserId is required, but a guest's online booking has
// no user; version 1 of those orders records this marker instead.
export const ONLINE_BOOKING_ACTOR_ID = "online-booking";

interface ResolvedLine {
  lineType: OrderLineType;
  serviceId: string | null;
  description: string;
  pricingType: Prisma.OrderLineCreateManyInput["pricingType"];
  requiresQuote: boolean;
  unitPrice: number | null;
  estimatedQuantity: string | null;
  quantity: string | null;
  lineTotal: number | null;
}

const SMS_TEMPLATE_ON_ENTER: Partial<Record<OrderStage, string>> = {
  QUOTE_AWAITING_APPROVAL: "QUOTE_NEEDS_APPROVAL",
  READY: "READY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
};

// Mirrors the app's order creation: one transaction that allocates the number
// from Store.nextOrderNumber and writes the order with its whole history.
export async function createSeedOrder(
  prisma: PrismaClient,
  ctx: SeedStoreContext,
  spec: SeedOrder,
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      const orderNumber = await allocateOrderNumber(tx, ctx.storeId);
      const times = stageTimes(ctx.now, spec);
      const orderId = await createOrderRow(tx, ctx, spec, orderNumber, times);
      const latestLines = spec.revisions[spec.revisions.length - 1].lines;
      await tx.orderLine.createMany({
        data: resolveLines(ctx, latestLines).map((line) => ({
          ...line,
          storeId: ctx.storeId,
          orderId,
        })),
      });
      const approvedQuoteId = await createRevisions(tx, ctx, spec, orderId, times);
      if (approvedQuoteId) {
        await tx.order.update({
          where: { storeId_id: { storeId: ctx.storeId, id: orderId } },
          data: { approvedQuoteId },
        });
      }
      await createHistory(tx, ctx, spec, orderId, times);
      await createPayments(tx, ctx, spec, orderId, orderNumber, times);
      return orderNumber;
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
}

async function allocateOrderNumber(tx: Tx, storeId: string): Promise<number> {
  // One UPDATE … RETURNING: the row lock serialises concurrent allocations.
  const { nextOrderNumber } = await tx.store.update({
    where: { id: storeId },
    data: { nextOrderNumber: { increment: 1 } },
    select: { nextOrderNumber: true },
  });
  return nextOrderNumber - 1;
}

// When the order entered each stage in `spec.stages`.
function stageTimes(now: Date, spec: SeedOrder): Date[] {
  const createdAt = hoursBefore(now, spec.createdHoursAgo);
  const stepHours = Math.min(6, spec.createdHoursAgo / spec.stages.length);
  return spec.stages.map((_, index) => hoursAfter(createdAt, index * stepHours));
}

async function createOrderRow(
  tx: Tx,
  ctx: SeedStoreContext,
  spec: SeedOrder,
  orderNumber: number,
  times: Date[],
): Promise<string> {
  const area = spec.area ? requireFrom(ctx.areas, spec.area, "service area") : undefined;
  const current = spec.stages[spec.stages.length - 1];
  const finishedAt = times[times.length - 1];
  const isOnline = spec.channel === OrderChannel.ONLINE;

  const order = await tx.order.create({
    data: {
      storeId: ctx.storeId,
      orderNumber,
      customerId: requireFrom(ctx.customerIds, spec.customerPhone, "customer"),
      channel: spec.channel,
      fulfilmentType: spec.fulfilmentType,
      stage: current,
      stageBeforeQuote:
        current === OrderStage.QUOTE_AWAITING_APPROVAL ? spec.stages[spec.stages.length - 2] : null,
      serviceAreaId: area?.id ?? null,
      addressText: spec.addressText ?? null,
      fulfilmentCharge: area?.chargeType === "FIXED" ? area.fixedCharge : null,
      ...pickupFields(spec, times[0]),
      payLater: spec.payLater ?? false,
      trackingTokenHash: seedTrackingTokenHash(),
      trackingTokenIssuedAt: times[0],
      internalNote: spec.internalNote ?? null,
      completedAt: current === OrderStage.COMPLETED ? finishedAt : null,
      cancelledAt: current === OrderStage.CANCELLED ? finishedAt : null,
      cancelNote: spec.cancelNote ?? null,
      createdByUserId: isOnline ? null : ctx.staffUserId,
      // A documentation-range IP (RFC 5737), hashed like a real booking.
      bookingIpHash: isOnline ? createHash("sha256").update("203.0.113.24").digest("hex") : null,
      createdAt: times[0],
    },
    select: { id: true },
  });
  return order.id;
}

function pickupFields(spec: SeedOrder, createdAt: Date) {
  if (!spec.pickup) return {};
  const { requestedInDays, window, status, scheduledWindow = window } = spec.pickup;
  const requestedDate = lagosDate(createdAt, requestedInDays);
  const isConfirmed = status === "CONFIRMED";
  return {
    requestedPickupDate: requestedDate,
    requestedWindowStart: window[0],
    requestedWindowEnd: window[1],
    scheduledPickupDate: isConfirmed ? requestedDate : null,
    scheduledWindowStart: isConfirmed ? scheduledWindow[0] : null,
    scheduledWindowEnd: isConfirmed ? scheduledWindow[1] : null,
    pickupWindowStatus: status,
  };
}

function resolveLines(ctx: SeedStoreContext, lines: SeedLine[]): ResolvedLine[] {
  return lines.map((line) => {
    if ("adjustment" in line) {
      return {
        lineType: OrderLineType.ADJUSTMENT,
        serviceId: null,
        description: line.adjustment,
        pricingType: null,
        requiresQuote: false,
        unitPrice: null,
        estimatedQuantity: null,
        quantity: null,
        lineTotal: line.amount,
      };
    }
    const service = requireFrom(ctx.services, line.service, "service");
    if (!line.quantity && !service.requiresQuote) {
      throw new Error(`Seed data: "${service.name}" needs a quantity (it isn't quote-required).`);
    }
    return {
      lineType: OrderLineType.SERVICE,
      serviceId: service.id,
      description: service.name,
      pricingType: service.pricingType,
      requiresQuote: service.requiresQuote,
      unitPrice: service.price,
      estimatedQuantity: line.estimate ?? null,
      quantity: line.quantity ?? null,
      lineTotal: line.quantity ? lineTotalKobo(service.price, line.quantity) : null,
    };
  });
}

// What a revision shows the customer. An unweighed line uses the customer's
// estimate when there is one and is left out otherwise (version 1 of a
// quote-required order is only ever an estimate and is never approved).
function revisionAmounts(ctx: SeedStoreContext, revision: SeedRevision, fulfilmentCharge: number) {
  const snapshot = resolveLines(ctx, revision.lines).flatMap((line) => {
    const shownQuantity = line.quantity ?? line.estimatedQuantity;
    if (line.lineType === OrderLineType.SERVICE && !shownQuantity) return [];
    const lineTotal =
      line.lineTotal ?? lineTotalKobo(line.unitPrice ?? 0, shownQuantity ?? "0");
    return [
      {
        lineType: line.lineType,
        serviceId: line.serviceId,
        description: line.description,
        pricingType: line.pricingType ?? null,
        unitPrice: line.unitPrice,
        quantity: shownQuantity,
        quantityIsEstimate: line.quantity === null && shownQuantity !== null,
        lineTotal,
      },
    ];
  });
  const itemsSubtotal = snapshot.reduce((sum, line) => sum + line.lineTotal, 0);
  return { snapshot, itemsSubtotal, total: itemsSubtotal + fulfilmentCharge };
}

async function createRevisions(
  tx: Tx,
  ctx: SeedStoreContext,
  spec: SeedOrder,
  orderId: string,
  times: Date[],
): Promise<string | null> {
  const area = spec.area ? ctx.areas.get(spec.area) : undefined;
  const fulfilmentCharge = area?.chargeType === "FIXED" ? (area.fixedCharge ?? 0) : 0;
  let approvedQuoteId: string | null = null;

  for (const [index, revision] of spec.revisions.entries()) {
    const step = revision.atStep ?? 0;
    const createdAt = times[step];
    const approvedAt =
      index === 0 ? createdAt : (times[step + 1] ?? earlierOf(hoursAfter(createdAt, 1), ctx.now));
    const { snapshot, itemsSubtotal, total } = revisionAmounts(ctx, revision, fulfilmentCharge);
    const created = await tx.quoteRevision.create({
      data: {
        storeId: ctx.storeId,
        orderId,
        version: index + 1,
        linesSnapshot: snapshot,
        itemsSubtotal,
        fulfilmentCharge,
        total,
        reason: revision.reason ?? null,
        status: revision.status,
        createdByUserId:
          index === 0 && spec.channel === OrderChannel.ONLINE ? ONLINE_BOOKING_ACTOR_ID : ctx.staffUserId,
        createdAt,
        approvedAt: revision.approvedBy ? approvedAt : null,
        approvedByActor: revision.approvedBy ?? null,
      },
      select: { id: true },
    });
    if (revision.status === "APPROVED") approvedQuoteId = created.id;
  }
  return approvedQuoteId;
}

function stageActor(spec: SeedOrder, index: number): ActorType {
  const to = spec.stages[index];
  const from = index > 0 ? spec.stages[index - 1] : null;
  if (from === null) return spec.channel === OrderChannel.ONLINE ? ActorType.CUSTOMER : ActorType.STAFF;
  if (to === OrderStage.QUOTE_AWAITING_APPROVAL) return ActorType.SYSTEM;
  if (from === OrderStage.QUOTE_AWAITING_APPROVAL) return ActorType.CUSTOMER;
  return ActorType.STAFF;
}

async function createHistory(
  tx: Tx,
  ctx: SeedStoreContext,
  spec: SeedOrder,
  orderId: string,
  times: Date[],
): Promise<void> {
  await tx.statusEvent.createMany({
    data: spec.stages.map((toStage, index) => {
      const actorType = stageActor(spec, index);
      return {
        storeId: ctx.storeId,
        orderId,
        fromStage: index > 0 ? spec.stages[index - 1] : null,
        toStage,
        actorType,
        actorUserId: actorUserIdFor(actorType, ctx),
        note: toStage === OrderStage.CANCELLED ? (spec.cancelNote ?? null) : null,
        createdAt: times[index],
      };
    }),
  });

  // Automatic SMS go only to +234 numbers.
  if (!spec.customerPhone.startsWith("+234")) return;
  const messages = spec.stages.flatMap((stage, index) => {
    const template = index === 0 ? "LINK_CREATED" : SMS_TEMPLATE_ON_ENTER[stage];
    if (!template) return [];
    const failed = index === 0 && spec.linkSmsFailed === true;
    return [
      {
        storeId: ctx.storeId,
        orderId,
        channel: MessageChannel.SMS,
        template,
        // Bodies hold the raw tracking token, so they're cleared once SENT or finally FAILED.
        status: failed ? MessageStatus.FAILED : MessageStatus.SENT,
        attempts: failed ? 3 : 1,
        lastError: failed ? "Provider request timed out" : null,
        sentAt: failed ? null : hoursAfter(times[index], 1 / 60),
        createdByUserId: actorUserIdFor(stageActor(spec, index), ctx),
        createdAt: times[index],
      },
    ];
  });
  await tx.messageEvent.createMany({ data: messages });
}

function actorUserIdFor(actor: ActorType, ctx: SeedStoreContext): string | null {
  return actor === ActorType.STAFF ? ctx.staffUserId : null;
}

async function createPayments(
  tx: Tx,
  ctx: SeedStoreContext,
  spec: SeedOrder,
  orderId: string,
  orderNumber: number,
  times: Date[],
): Promise<void> {
  for (const [index, payment] of (spec.payments ?? []).entries()) {
    const isOnline = payment.source === PaymentSource.ONLINE;
    await tx.payment.create({
      data: {
        storeId: ctx.storeId,
        orderId,
        amount: payment.amount,
        source: payment.source,
        method: payment.method,
        status: PaymentStatus.CONFIRMED,
        paystackReference: isOnline ? `seed-${ctx.orderPrefix}-${orderNumber}-${index + 1}` : null,
        payerEmail: payment.payerEmail ?? null,
        recordedByUserId: isOnline ? null : ctx.staffUserId,
        confirmedAt: earlierOf(hoursAfter(times[payment.atStep], 0.5), ctx.now),
        createdAt: times[payment.atStep],
      },
    });
  }
}

function earlierOf(a: Date, b: Date): Date {
  return a < b ? a : b;
}

function requireFrom<T>(map: Map<string, T>, key: string, kind: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Seed data: unknown ${kind} "${key}".`);
  return value;
}
