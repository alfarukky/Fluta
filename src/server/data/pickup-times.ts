import "server-only";

import { z } from "zod";

import type { OrderStage, Prisma, QuoteStatus } from "@/generated/prisma/client";

import { getPrisma } from "./client";
import { ORDER_AUDIT_TARGET } from "./quotes";
import { TRACKING_AUDIT_ACTIONS } from "./tracking";

// A pickup order's time: Requested (by the customer when booking) →
// Suggested by the store (optional, can be replaced) → Confirmed. The
// customer's request stays in the requested fields; a suggestion or the
// confirmed time is kept in the scheduled fields.
//
// Each change runs in one transaction: it reads the order, asks `decide` (the
// caller's rules, canTransition included), then makes one conditional update
// that only matches the order as it was read. That update takes the order's
// row lock, so anything else changing the order at the same moment (another
// pickup change, a price update being sent) waits for it or makes it match
// nothing. After the update, a price update sent in the meantime is checked
// once more, and rolls the change back. Staff changes are scoped by the
// member's storeId; the customer's by their token hash.

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export type PickupChangeOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  | { status: "CONFLICT" }
  | { status: "CHANGED" };

// What the rules need: the stage rules' fields, and the pickup time.
const PICKUP_ORDER_FIELDS = {
  id: true,
  storeId: true,
  stage: true,
  fulfilmentType: true,
  stageBeforeQuote: true,
  approvedQuoteId: true,
  requestedPickupDate: true,
  requestedWindowStart: true,
  requestedWindowEnd: true,
  scheduledPickupDate: true,
  scheduledWindowStart: true,
  scheduledWindowEnd: true,
  pickupWindowStatus: true,
} as const satisfies Prisma.OrderSelect;

const REVISIONS_READ = { select: { version: true, status: true, approvedAt: true, declinedAt: true } } as const;
const EVENTS_READ = { select: { id: true, fromStage: true, toStage: true, createdAt: true } } as const;

export type PickupOrderRecord = Prisma.OrderGetPayload<{ select: typeof PICKUP_ORDER_FIELDS }> & {
  quoteRevisions: { version: number; status: QuoteStatus; approvedAt: Date | null; declinedAt: Date | null }[];
  statusEvents: { id: string; fromStage: OrderStage | null; toStage: OrderStage; createdAt: Date }[];
};

async function readPickupOrder(
  tx: Prisma.TransactionClient,
  where: Prisma.OrderWhereUniqueInput,
): Promise<PickupOrderRecord | null> {
  const order = await tx.order.findUnique({ where, select: PICKUP_ORDER_FIELDS });
  if (!order) return null;
  const scope = { storeId: order.storeId, orderId: order.id };
  return {
    ...order,
    quoteRevisions: await tx.quoteRevision.findMany({ where: scope, ...REVISIONS_READ }),
    statusEvents: await tx.statusEvent.findMany({ where: scope, ...EVENTS_READ }),
  };
}

// A price update sent and still waiting for the customer (a version 1 that
// was never sent is only an estimate).
async function hasPriceUpdateWaiting(tx: Prisma.TransactionClient, storeId: string, orderId: string): Promise<boolean> {
  const waiting = await tx.quoteRevision.count({ where: { storeId, orderId, status: "PENDING", version: { gt: 1 } } });
  return waiting > 0;
}

// Undoes the transaction when the order changed under the conditional update.
class PickupConflict extends Error {}

function runPickupChange<T>(
  work: (tx: Prisma.TransactionClient) => Promise<PickupChangeOutcome<T>>,
): Promise<PickupChangeOutcome<T>> {
  return getPrisma()
    .$transaction(work, TRANSACTION_OPTIONS)
    .catch((error: unknown): PickupChangeOutcome<T> => {
      if (error instanceof PickupConflict) return { status: "CONFLICT" };
      throw error;
    });
}

// ───────────── Staff: confirm the requested time ─────────────

// The scheduled time becomes the requested one, the time is Confirmed, and
// the order moves from Booked to Pickup scheduled, with its status event.
export async function confirmRequestedPickup<T>(
  storeId: string,
  orderId: string,
  decide: (order: PickupOrderRecord) => T | null,
  actorUserId: string,
  now: Date,
): Promise<PickupChangeOutcome<T>> {
  return runPickupChange<T>(async (tx) => {
    const order = await readPickupOrder(tx, { storeId_id: { storeId, id: orderId } });
    if (!order) return { status: "NOT_FOUND" };
    const refusal = decide(order);
    if (refusal !== null) return { status: "REFUSED", refusal };

    const { count } = await tx.order.updateMany({
      where: {
        storeId,
        id: orderId,
        stage: "BOOKED",
        pickupWindowStatus: "REQUESTED",
        requestedPickupDate: order.requestedPickupDate,
        requestedWindowStart: order.requestedWindowStart,
        requestedWindowEnd: order.requestedWindowEnd,
      },
      data: {
        stage: "PICKUP_SCHEDULED",
        pickupWindowStatus: "CONFIRMED",
        scheduledPickupDate: order.requestedPickupDate,
        scheduledWindowStart: order.requestedWindowStart,
        scheduledWindowEnd: order.requestedWindowEnd,
      },
    });
    if (count === 0) return { status: "CONFLICT" };
    if (await hasPriceUpdateWaiting(tx, storeId, orderId)) throw new PickupConflict();

    await tx.statusEvent.create({
      data: { storeId, orderId, fromStage: "BOOKED", toStage: "PICKUP_SCHEDULED", actorType: "STAFF", actorUserId, createdAt: now },
    });
    return { status: "CHANGED" };
  });
}

// ───────────── Staff: suggest another time ─────────────

export interface PickupSuggestion {
  date: Date; // the calendar date (UTC midnight)
  windowStart: string; // "10:00"
  windowEnd: string;
  isOutsideSchedule: boolean;
  // Required outside the normal schedule; null otherwise. Kept in the audit
  // event only, never on the order (its internal note is left as it is).
  note: string | null;
}

// Saves the suggestion as the scheduled time (Suggested by the store), with
// its own isOutsideSchedule (nothing carries over from an earlier one), and
// records it in an AuditEvent: one per suggestion, so replacing one keeps the
// history. The order stays Booked.
export async function suggestPickupTime<T>(
  storeId: string,
  orderId: string,
  suggestion: PickupSuggestion,
  decide: (order: PickupOrderRecord) => T | null,
  actorUserId: string,
  now: Date,
): Promise<PickupChangeOutcome<T>> {
  return runPickupChange<T>(async (tx) => {
    const order = await readPickupOrder(tx, { storeId_id: { storeId, id: orderId } });
    if (!order) return { status: "NOT_FOUND" };
    const refusal = decide(order);
    if (refusal !== null) return { status: "REFUSED", refusal };

    const { count } = await tx.order.updateMany({
      where: {
        storeId,
        id: orderId,
        stage: "BOOKED",
        pickupWindowStatus: order.pickupWindowStatus,
        scheduledPickupDate: order.scheduledPickupDate,
        scheduledWindowStart: order.scheduledWindowStart,
        scheduledWindowEnd: order.scheduledWindowEnd,
      },
      data: {
        pickupWindowStatus: "PROPOSED_BY_STORE",
        scheduledPickupDate: suggestion.date,
        scheduledWindowStart: suggestion.windowStart,
        scheduledWindowEnd: suggestion.windowEnd,
        isOutsideSchedule: suggestion.isOutsideSchedule,
      },
    });
    if (count === 0) return { status: "CONFLICT" };
    if (await hasPriceUpdateWaiting(tx, storeId, orderId)) throw new PickupConflict();

    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "STAFF",
        actorUserId,
        action: TRACKING_AUDIT_ACTIONS.pickupSuggested,
        targetType: ORDER_AUDIT_TARGET,
        targetId: orderId,
        metadata: {
          date: suggestion.date.toISOString().slice(0, 10),
          windowStart: suggestion.windowStart,
          windowEnd: suggestion.windowEnd,
          isOutsideSchedule: suggestion.isOutsideSchedule,
          note: suggestion.note,
        },
        createdAt: now,
      },
    });
    return { status: "CHANGED" };
  });
}

// ───────────── Customer: accept the store's suggestion ─────────────

export interface SuggestionRef {
  // The suggestion's AuditEvent: only the latest one can be accepted.
  id: string;
}

// The time becomes Confirmed and the order moves from Booked to Pickup
// scheduled (actor CUSTOMER), only while this is still the latest suggestion
// and the order is still the one this token opens.
export async function acceptPickupSuggestion<T>(
  tokenHash: string,
  suggestion: SuggestionRef,
  decide: (order: PickupOrderRecord) => T | null,
  now: Date,
): Promise<PickupChangeOutcome<T>> {
  return runPickupChange<T>(async (tx) => {
    const order = await readPickupOrder(tx, { trackingTokenHash: tokenHash });
    if (!order) return { status: "NOT_FOUND" };
    const refusal = decide(order);
    if (refusal !== null) return { status: "REFUSED", refusal };
    const { storeId, id: orderId } = order;

    const { count } = await tx.order.updateMany({
      where: {
        storeId,
        id: orderId,
        trackingTokenHash: tokenHash,
        stage: "BOOKED",
        pickupWindowStatus: "PROPOSED_BY_STORE",
        scheduledPickupDate: order.scheduledPickupDate,
        scheduledWindowStart: order.scheduledWindowStart,
        scheduledWindowEnd: order.scheduledWindowEnd,
      },
      data: { stage: "PICKUP_SCHEDULED", pickupWindowStatus: "CONFIRMED" },
    });
    if (count === 0) return { status: "CONFLICT" };
    // Read after the update, so a suggestion saved just before it is seen.
    const latest = await findLatestSuggestionIn(tx, storeId, orderId);
    if (latest?.id !== suggestion.id) throw new PickupConflict();
    if (await hasPriceUpdateWaiting(tx, storeId, orderId)) throw new PickupConflict();

    await tx.statusEvent.create({
      data: { storeId, orderId, fromStage: "BOOKED", toStage: "PICKUP_SCHEDULED", actorType: "CUSTOMER", createdAt: now },
    });
    return { status: "CHANGED" };
  });
}

// ───────────── Reading suggestions ─────────────

const suggestionMetadataSchema = z.object({
  date: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  isOutsideSchedule: z.boolean(),
  note: z.string().nullable(),
});

export interface PickupSuggestionRecord {
  id: string;
  actorUserId: string | null;
  createdAt: Date;
  date: string; // "YYYY-MM-DD"
  windowStart: string;
  windowEnd: string;
  isOutsideSchedule: boolean;
  note: string | null;
}

const SUGGESTION_READ = {
  select: { id: true, actorUserId: true, createdAt: true, metadata: true },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
} as const satisfies Prisma.AuditEventFindManyArgs;

function suggestionsWhere(storeId: string, orderId: string): Prisma.AuditEventWhereInput {
  return { storeId, targetType: ORDER_AUDIT_TARGET, targetId: orderId, action: TRACKING_AUDIT_ACTIONS.pickupSuggested };
}

function toSuggestion(event: { id: string; actorUserId: string | null; createdAt: Date; metadata: Prisma.JsonValue }) {
  const metadata = suggestionMetadataSchema.safeParse(event.metadata);
  if (!metadata.success) return [];
  return [{ id: event.id, actorUserId: event.actorUserId, createdAt: event.createdAt, ...metadata.data }];
}

// Every suggestion for the order, newest first (the staff timeline).
export async function findPickupSuggestions(storeId: string, orderId: string): Promise<PickupSuggestionRecord[]> {
  const events = await getPrisma().auditEvent.findMany({ where: suggestionsWhere(storeId, orderId), ...SUGGESTION_READ });
  return events.flatMap(toSuggestion);
}

// The newest suggestion only: the one the customer may accept.
export async function findLatestPickupSuggestion(storeId: string, orderId: string): Promise<PickupSuggestionRecord | null> {
  return findLatestSuggestionIn(getPrisma(), storeId, orderId);
}

async function findLatestSuggestionIn(
  client: Prisma.TransactionClient,
  storeId: string,
  orderId: string,
): Promise<PickupSuggestionRecord | null> {
  const event = await client.auditEvent.findFirst({ where: suggestionsWhere(storeId, orderId), ...SUGGESTION_READ });
  return event ? (toSuggestion(event)[0] ?? null) : null;
}
