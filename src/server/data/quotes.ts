import "server-only";

import type { ActorType, OrderStage, Prisma } from "@/generated/prisma/client";

import { getPrisma } from "./client";
import { isUniqueViolation } from "./errors";
import type { NewOrderLineData } from "./orders";

// Quote revisions, decisions, and address changes. storeId always comes from
// the caller's membership and is part of every where clause, so an order,
// line, or revision ID from another store matches nothing.

// Neon round trips are slow from here; these transactions make several.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export const QUOTE_AUDIT_TARGET = "QuoteRevision";
export const ORDER_AUDIT_TARGET = "Order";

export const AUDIT_ACTIONS = {
  approvalRecorded: "QUOTE_APPROVAL_RECORDED",
  declineRecorded: "QUOTE_DECLINE_RECORDED",
  addressChanged: "ORDER_ADDRESS_CHANGED",
} as const;

// ───────────── The order as the quote editor and the rules see it ─────────────

const ORDER_FIELDS = {
  id: true,
  orderNumber: true,
  stage: true,
  stageBeforeQuote: true,
  fulfilmentType: true,
  serviceAreaId: true,
  serviceAreaName: true,
  isOutOfArea: true,
  fulfilmentCharge: true,
  addressText: true,
  pickupWindowStatus: true,
  approvedQuoteId: true,
} as const satisfies Prisma.OrderSelect;

const APPROVED_QUOTE_FIELDS = { id: true, version: true, total: true } as const;
const AREA_FIELDS = { id: true, name: true, chargeType: true, fixedCharge: true } as const;
const LINES_READ = {
  select: {
    id: true,
    lineType: true,
    serviceId: true,
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
} as const satisfies Prisma.OrderLineFindManyArgs;
const REVISIONS_READ = {
  select: { id: true, version: true, status: true, total: true, reason: true, approvedAt: true, declinedAt: true },
  orderBy: { version: "desc" },
} as const satisfies Prisma.QuoteRevisionFindManyArgs;
const EVENTS_READ = {
  select: { id: true, fromStage: true, toStage: true, createdAt: true },
} as const satisfies Prisma.StatusEventFindManyArgs;

const QUOTE_ORDER_SELECT = {
  ...ORDER_FIELDS,
  store: { select: { orderPrefix: true } },
  approvedQuote: { select: APPROVED_QUOTE_FIELDS },
  serviceArea: { select: AREA_FIELDS },
  lines: LINES_READ,
  quoteRevisions: REVISIONS_READ,
  statusEvents: EVENTS_READ,
} as const satisfies Prisma.OrderSelect;

export type QuoteOrderRecord = Prisma.OrderGetPayload<{ select: typeof QUOTE_ORDER_SELECT }>;

export async function findQuoteOrder(storeId: string, orderId: string): Promise<QuoteOrderRecord | null> {
  return getPrisma().order.findUnique({ where: { storeId_id: { storeId, id: orderId } }, select: QUOTE_ORDER_SELECT });
}

// The same record, read inside a transaction one query at a time. Prisma
// otherwise loads a read's relations in parallel, which on one transaction
// connection means overlapping queries (deprecated in pg, removed in pg@9).
async function readQuoteOrder(tx: Prisma.TransactionClient, storeId: string, orderId: string): Promise<QuoteOrderRecord | null> {
  const order = await tx.order.findUnique({ where: { storeId_id: { storeId, id: orderId } }, select: ORDER_FIELDS });
  if (!order) return null;
  const store = await tx.store.findUniqueOrThrow({ where: { id: storeId }, select: { orderPrefix: true } });
  const approvedQuote = order.approvedQuoteId
    ? await tx.quoteRevision.findUnique({
        where: { storeId_id: { storeId, id: order.approvedQuoteId } },
        select: APPROVED_QUOTE_FIELDS,
      })
    : null;
  const serviceArea = order.serviceAreaId
    ? await tx.serviceArea.findFirst({ where: { storeId, id: order.serviceAreaId }, select: AREA_FIELDS })
    : null;
  return {
    ...order,
    store,
    approvedQuote,
    serviceArea,
    lines: await tx.orderLine.findMany({ where: { storeId, orderId }, ...LINES_READ }),
    quoteRevisions: await tx.quoteRevision.findMany({ where: { storeId, orderId }, ...REVISIONS_READ }),
    statusEvents: await tx.statusEvent.findMany({ where: { storeId, orderId }, ...EVENTS_READ }),
  };
}

// ───────────── Issuing a revision ─────────────

export interface NewRevision {
  // The stage and newest version the decision was made on.
  seenStage: OrderStage;
  version: number;
  fulfilment: {
    serviceAreaId: string | null;
    serviceAreaName: string | null;
    isOutOfArea: boolean;
    fulfilmentCharge: number | null;
  };
  lines: NewOrderLineData[];
  revision: {
    linesSnapshot: Prisma.InputJsonValue;
    itemsSubtotal: number;
    fulfilmentCharge: number;
    total: number;
    reason: string | null;
  };
  actorUserId: string;
  // The first priced quote moves the order into Quote awaiting approval (a
  // system move) and remembers where it came from.
  enterQuoteAwaitingApproval: boolean;
}

export type IssueOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  | { status: "CONFLICT" }
  | { status: "ISSUED"; revisionId: string; version: number; stage: OrderStage };

// In one transaction: reads the order as it is now, asks `decide` (the
// caller's rules) for the revision, then saves it all or nothing:
// - the order (only if it is still at the stage the decision saw),
// - any pending revision superseded,
// - the next version (the unique rule on order and version refuses a second
//   one issued at the same moment),
// - the working lines replaced, and the stage event if the stage moves.
export async function issueRevision<T>(
  storeId: string,
  orderId: string,
  decide: (order: QuoteOrderRecord) => { ok: true; revision: NewRevision } | { ok: false; refusal: T },
  now: Date,
): Promise<IssueOutcome<T>> {
  try {
    return await getPrisma().$transaction(async (tx) => {
      const order = await readQuoteOrder(tx, storeId, orderId);
      if (!order) return { status: "NOT_FOUND" as const };

      const decision = decide(order);
      if (!decision.ok) return { status: "REFUSED" as const, refusal: decision.refusal };
      const plan = decision.revision;
      const stage = plan.enterQuoteAwaitingApproval ? "QUOTE_AWAITING_APPROVAL" : plan.seenStage;

      const { count } = await tx.order.updateMany({
        where: { storeId, id: orderId, stage: plan.seenStage },
        data: {
          ...plan.fulfilment,
          ...(plan.enterQuoteAwaitingApproval && { stage, stageBeforeQuote: plan.seenStage }),
        },
      });
      if (count === 0) return { status: "CONFLICT" as const };

      await tx.quoteRevision.updateMany({
        where: { storeId, orderId, status: "PENDING" },
        data: { status: "SUPERSEDED" },
      });
      const revision = await tx.quoteRevision.create({
        data: {
          storeId,
          orderId,
          version: plan.version,
          ...plan.revision,
          status: "PENDING",
          createdByActor: "STAFF",
          createdByUserId: plan.actorUserId,
          createdAt: now,
        },
        select: { id: true },
      });

      await tx.orderLine.deleteMany({ where: { storeId, orderId } });
      await tx.orderLine.createMany({ data: plan.lines.map((line) => ({ ...line, storeId, orderId })) });

      if (plan.enterQuoteAwaitingApproval) {
        await tx.statusEvent.create({
          data: {
            storeId,
            orderId,
            fromStage: plan.seenStage,
            toStage: stage,
            actorType: "SYSTEM",
            actorUserId: null,
            createdAt: now,
          },
        });
      }
      return { status: "ISSUED" as const, revisionId: revision.id, version: plan.version, stage };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    // Another revision took this version number first.
    if (isUniqueViolation(error)) return { status: "CONFLICT" };
    throw error;
  }
}

// ───────────── Approving and declining ─────────────

const DECISION_ORDER_SELECT = {
  stage: true,
  stageBeforeQuote: true,
  fulfilmentType: true,
  approvedQuoteId: true,
  pickupWindowStatus: true,
  quoteRevisions: { select: { id: true, version: true, status: true, approvedAt: true, declinedAt: true } },
  statusEvents: { select: { id: true, fromStage: true, toStage: true, createdAt: true } },
} as const satisfies Prisma.OrderSelect;

export type DecisionOrderRecord = Prisma.OrderGetPayload<{ select: typeof DECISION_ORDER_SELECT }>;

// One query at a time, for the same reason as readQuoteOrder.
async function readDecisionOrder(tx: Prisma.TransactionClient, storeId: string, orderId: string): Promise<DecisionOrderRecord | null> {
  const { quoteRevisions: revisionsRead, statusEvents: eventsRead, ...fields } = DECISION_ORDER_SELECT;
  const order = await tx.order.findUnique({ where: { storeId_id: { storeId, id: orderId } }, select: fields });
  if (!order) return null;
  return {
    ...order,
    quoteRevisions: await tx.quoteRevision.findMany({ where: { storeId, orderId }, ...revisionsRead }),
    statusEvents: await tx.statusEvent.findMany({ where: { storeId, orderId }, ...eventsRead }),
  };
}

export interface RevisionDecision {
  revisionId: string;
  decision: "APPROVE" | "DECLINE";
  actorType: ActorType;
  customerMessage: string | null;
  // Returning from Quote awaiting approval to the stage before the quote.
  returnTo: OrderStage | null;
  // Staff recording a decision the customer gave in person or by phone.
  audit: { actorUserId: string; action: string; note: string | null; version: number } | null;
}

export type DecisionOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  | { status: "CONFLICT" }
  | { status: "DECIDED" };

// Approving or declining, in one transaction. The revision changes only if
// it is still pending (one conditional update), so of two decisions made at
// the same moment exactly one succeeds. Approving supersedes the previously
// approved revision, points approvedQuoteId at this one, and returns an order
// in Quote awaiting approval to exactly the stage before the quote.
export async function decideRevision<T>(
  storeId: string,
  orderId: string,
  decide: (order: DecisionOrderRecord) => { ok: true; decision: RevisionDecision } | { ok: false; refusal: T },
  now: Date,
): Promise<DecisionOutcome<T>> {
  return getPrisma().$transaction(async (tx): Promise<DecisionOutcome<T>> => {
    const order = await readDecisionOrder(tx, storeId, orderId);
    if (!order) return { status: "NOT_FOUND" };

    const result = decide(order);
    if (!result.ok) return { status: "REFUSED", refusal: result.refusal };
    const { decision } = result;
    const approve = decision.decision === "APPROVE";

    const { count } = await tx.quoteRevision.updateMany({
      where: { storeId, orderId, id: decision.revisionId, status: "PENDING" },
      data: approve
        ? { status: "APPROVED", approvedAt: now, approvedByActor: decision.actorType }
        : { status: "DECLINED", declinedAt: now, customerMessage: decision.customerMessage },
    });
    if (count === 0) return { status: "CONFLICT" };

    if (approve) {
      await tx.quoteRevision.updateMany({
        where: { storeId, orderId, status: "APPROVED", id: { not: decision.revisionId } },
        data: { status: "SUPERSEDED" },
      });
      const returning = decision.returnTo !== null;
      const moved = await tx.order.updateMany({
        where: { storeId, id: orderId, ...(returning && { stage: "QUOTE_AWAITING_APPROVAL" }) },
        data: {
          approvedQuoteId: decision.revisionId,
          ...(returning && { stage: decision.returnTo ?? undefined, stageBeforeQuote: null }),
        },
      });
      // The order left Quote awaiting approval in the meantime (cancelled, say).
      if (moved.count === 0) throw new DecisionConflict();
      if (returning) {
        await tx.statusEvent.create({
          data: {
            storeId,
            orderId,
            fromStage: "QUOTE_AWAITING_APPROVAL",
            toStage: decision.returnTo ?? "RECEIVED_BY_STORE",
            actorType: "SYSTEM",
            actorUserId: null,
            createdAt: now,
          },
        });
      }
    }

    if (decision.audit) {
      await tx.auditEvent.create({
        data: {
          storeId,
          actorType: "STAFF",
          actorUserId: decision.audit.actorUserId,
          action: decision.audit.action,
          targetType: QUOTE_AUDIT_TARGET,
          targetId: decision.revisionId,
          reason: decision.audit.note,
          metadata: { orderId, version: decision.audit.version },
          createdAt: now,
        },
      });
    }
    return { status: "DECIDED" };
  }, TRANSACTION_OPTIONS).catch((error: unknown): DecisionOutcome<T> => {
    if (error instanceof DecisionConflict) return { status: "CONFLICT" };
    throw error;
  });
}

// Rolls the decision back when the order moved on while it was being made.
class DecisionConflict extends Error {}

// ───────────── Editing the address ─────────────

export type AddressOutcome<T> =
  | { status: "NOT_FOUND" }
  | { status: "REFUSED"; refusal: T }
  | { status: "CONFLICT" }
  | { status: "UNCHANGED" }
  | { status: "CHANGED" };

// Changes a pickup order's address and records the old and new address in
// an AuditEvent (staff only), in one transaction. The address changes only if
// the order is still at the stage, and has the address, the decision saw.
export async function changeOrderAddress<T>(
  storeId: string,
  orderId: string,
  address: string,
  decide: (order: { stage: OrderStage; fulfilmentType: QuoteOrderRecord["fulfilmentType"] }) => T | null,
  actorUserId: string,
  now: Date,
): Promise<AddressOutcome<T>> {
  return getPrisma().$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { storeId_id: { storeId, id: orderId } },
      select: { stage: true, fulfilmentType: true, addressText: true },
    });
    if (!order) return { status: "NOT_FOUND" };
    const refusal = decide(order);
    if (refusal !== null) return { status: "REFUSED", refusal };
    if (order.addressText === address) return { status: "UNCHANGED" };

    const { count } = await tx.order.updateMany({
      where: { storeId, id: orderId, stage: order.stage, addressText: order.addressText },
      data: { addressText: address },
    });
    if (count === 0) return { status: "CONFLICT" };

    await tx.auditEvent.create({
      data: {
        storeId,
        actorType: "STAFF",
        actorUserId,
        action: AUDIT_ACTIONS.addressChanged,
        targetType: ORDER_AUDIT_TARGET,
        targetId: orderId,
        metadata: { from: order.addressText, to: address },
        createdAt: now,
      },
    });
    return { status: "CHANGED" };
  }, TRANSACTION_OPTIONS);
}

// ───────────── Lookups for pricing ─────────────

// One of the store's areas, active or not (the order's own area).
export async function findServiceAreaCharge(storeId: string, areaId: string) {
  return getPrisma().serviceArea.findFirst({
    where: { storeId, id: areaId },
    select: { id: true, name: true, chargeType: true, fixedCharge: true },
  });
}

// Audit events for an order's revisions (who recorded each decision), oldest first.
export async function findRevisionAudits(storeId: string, revisionIds: readonly string[]) {
  if (revisionIds.length === 0) return [];
  return getPrisma().auditEvent.findMany({
    where: { storeId, targetType: QUOTE_AUDIT_TARGET, targetId: { in: [...revisionIds] } },
    select: { id: true, action: true, actorUserId: true, targetId: true, reason: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export type RevisionAuditRecord = Awaited<ReturnType<typeof findRevisionAudits>>[number];
