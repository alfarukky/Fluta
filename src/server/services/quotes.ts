import "server-only";

import type { ActorType } from "@/generated/prisma/client";
import { MESSAGE_TEMPLATES } from "@/lib/messages";
import { formatNaira } from "@/lib/money";
import { formatOrderNumber, isAwaitingApproval } from "@/lib/orders";
import { fromStoredQuantity, toStoredQuantity } from "@/lib/quantity";
import { canReviseQuote, findPendingRevision, isRevisionReasonRequired } from "@/lib/quotes";
import { generateToken } from "@/lib/tokens";
import type { EditAddressInput, IssueRevisionInput, RecordDecisionInput } from "@/schemas/quotes";
import { findActiveServiceArea, listActiveServiceAreas } from "@/server/data/fulfilment";
import type { NewOrderLineData } from "@/server/data/orders";
import {
  AUDIT_ACTIONS,
  changeOrderAddress,
  decideRevision,
  findQuoteOrder,
  issueRevision,
  type DecisionOrderRecord,
  type NewRevision,
  type QuoteOrderRecord,
  type RevisionDecision,
} from "@/server/data/quotes";
import { findActiveServices, listActiveServices } from "@/server/data/services";
import { canTransition, getStageOrderState, toContext } from "@/server/domain/order-stages";
import type { PricedOrderLine } from "@/server/domain/orders";
import {
  buildRevision,
  isCurrentChargeEntered,
  priceRevisionLines,
  resolveRevisionFulfilment,
  type AreaCharge,
  type CatalogueServicePrice,
  type ExistingOrderLine,
} from "@/server/domain/quotes";
import type { OrderEntryArea, OrderEntryService, QuoteEditorData } from "@/types/orders";

import { customerMessages, sendAfterCommit } from "./notifications";

// Quotes and revisions: issuing a revision, approving or declining one, and
// editing a pickup order's address. storeId and the user always come from the
// caller's membership (see src/actions/quotes.ts). Every rule is checked
// again inside the transaction, against the order as it is in the database.

export const ORDER_NOT_FOUND_MESSAGE = "Order not found.";
export const ORDER_CHANGED_MESSAGE = "This order was just updated. Refresh to see the latest.";

export interface QuoteActor {
  storeId: string;
  userId: string;
}

export type QuoteError =
  | "NOT_FOUND"
  | "CONFLICT"
  | "NOT_REVISABLE"
  | "LINE_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "PRICE_NOT_ALLOWED"
  | "NO_SERVICES"
  | "AREA_UNAVAILABLE"
  | "CHARGE_REQUIRED"
  | "NOT_FULLY_PRICED"
  | "NEGATIVE_TOTAL"
  | "REASON_REQUIRED"
  | "NOT_ALLOWED";

export type QuoteFailure = { ok: false; error: QuoteError; message: string; fieldErrors?: Record<string, string> };

const fail = (error: QuoteError, message: string, fieldErrors?: Record<string, string>): QuoteFailure => ({
  ok: false,
  error,
  message,
  ...(fieldErrors && { fieldErrors }),
});

// Why an order's quote (or address) can't be changed at its stage.
function notRevisableMessage(stage: QuoteOrderRecord["stage"], what: "quote" | "address"): string {
  if (stage === "CANCELLED") return "This order is cancelled.";
  if (stage === "COMPLETED") return "This order is completed.";
  return what === "quote"
    ? "The quote can't be changed once an order is out for delivery."
    : "The address can't be changed once an order is out for delivery.";
}

// ───────────── The edit-quote screen ─────────────

export interface QuoteEditor {
  editor: QuoteEditorData;
  services: OrderEntryService[];
  areas: OrderEntryArea[];
}

// Null for an order that isn't this store's, exactly as for one that doesn't exist.
export async function loadQuoteEditor(storeId: string, orderId: string): Promise<QuoteEditor | null> {
  const [order, services, areas] = await Promise.all([
    findQuoteOrder(storeId, orderId),
    listActiveServices(storeId),
    listActiveServiceAreas(storeId),
  ]);
  if (!order) return null;

  const pickup = order.fulfilmentType === "PICKUP_DELIVERY";
  return {
    editor: {
      orderId: order.id,
      displayNumber: formatOrderNumber(order.store, order.orderNumber),
      stage: order.stage,
      fulfilmentType: order.fulfilmentType,
      latestVersion: order.quoteRevisions[0]?.version ?? 0,
      lines: order.lines.flatMap((line) =>
        line.lineType === "SERVICE" && line.pricingType && line.unitPrice !== null
          ? [
              {
                id: line.id,
                name: line.description,
                pricingType: line.pricingType,
                requiresQuote: line.requiresQuote,
                unitPrice: line.unitPrice,
                quantity: line.quantity === null ? null : fromStoredQuantity(line.quantity.toString()),
                estimate: line.estimatedQuantity === null ? null : fromStoredQuantity(line.estimatedQuantity.toString()),
              },
            ]
          : [],
      ),
      adjustments: order.lines.flatMap((line) =>
        line.lineType === "ADJUSTMENT" ? [{ description: line.description, amount: line.lineTotal ?? 0 }] : [],
      ),
      pickup: pickup
        ? {
            areaName: order.serviceAreaName,
            isOutOfArea: order.isOutOfArea,
            chargeEntered: isCurrentChargeEntered(order, order.serviceArea),
            charge: order.fulfilmentCharge,
          }
        : null,
      approvedTotal: order.approvedQuote?.total ?? null,
      hasPendingRevision: findPendingRevision(order.quoteRevisions) !== null,
      reasonRequired: isRevisionReasonRequired(order.approvedQuoteId !== null),
    },
    services,
    areas,
  };
}

// ───────────── Issuing a revision ─────────────

export type IssueRevisionResult = { ok: true; version: number; message: string } | QuoteFailure;

export async function issueQuoteRevision(actor: QuoteActor, input: IssueRevisionInput, now: Date): Promise<IssueRevisionResult> {
  // The catalogue and the chosen area are read first; the order itself is
  // read again inside the transaction.
  const newServiceIds = input.lines.flatMap((line) => (line.kind === "new" ? [line.serviceId] : []));
  const [services, chosenArea] = await Promise.all([
    newServiceIds.length > 0 ? findActiveServices(actor.storeId, newServiceIds) : Promise.resolve([]),
    input.area.kind === "area" ? findActiveServiceArea(actor.storeId, input.area.areaId) : Promise.resolve(null),
  ]);
  const catalogue = new Map(services.map((service): [string, CatalogueServicePrice] => [service.id, service]));

  const outcome = await issueRevision<QuoteFailure>(
    actor.storeId,
    input.orderId,
    (order) => planRevision(order, input, catalogue, chosenArea, actor.userId),
    // A fresh link: the customer approves the new price there.
    customerMessages({
      template: MESSAGE_TEMPLATES.priceUpdate,
      createdByUserId: actor.userId,
      link: { token: generateToken(), stored: false },
    }),
    now,
  );

  switch (outcome.status) {
    case "ISSUED":
      await sendAfterCommit(outcome.queued);
      return {
        ok: true,
        version: outcome.version,
        message:
          outcome.stage === "QUOTE_AWAITING_APPROVAL"
            ? `Quote v${outcome.version} sent for approval`
            : `Revised quote v${outcome.version} sent for approval`,
      };
    case "NOT_FOUND":
      return fail("NOT_FOUND", ORDER_NOT_FOUND_MESSAGE);
    case "CONFLICT":
      return fail("CONFLICT", ORDER_CHANGED_MESSAGE);
    case "REFUSED":
      return outcome.refusal;
  }
}

function planRevision(
  order: QuoteOrderRecord,
  input: IssueRevisionInput,
  catalogue: ReadonlyMap<string, CatalogueServicePrice>,
  chosenArea: AreaCharge | null,
  userId: string,
): { ok: true; revision: NewRevision } | { ok: false; refusal: QuoteFailure } {
  const refuse = (failure: QuoteFailure) => ({ ok: false as const, refusal: failure });

  if (!canReviseQuote(order.stage)) return refuse(fail("NOT_REVISABLE", notRevisableMessage(order.stage, "quote")));
  const latestVersion = order.quoteRevisions[0]?.version ?? 0;
  if (latestVersion !== input.basedOnVersion) return refuse(fail("CONFLICT", ORDER_CHANGED_MESSAGE));

  const fulfilment = resolveRevisionFulfilment({
    order,
    currentArea: order.serviceArea,
    chosenArea,
    request: { area: input.area, charge: input.charge },
  });
  if (!fulfilment.ok) {
    const error = fulfilment.field === "area" ? "AREA_UNAVAILABLE" : "CHARGE_REQUIRED";
    return refuse(fail(error, fulfilment.message, { [fulfilment.field]: fulfilment.message }));
  }

  const existing = order.lines.map(
    (line): ExistingOrderLine => ({
      id: line.id,
      lineType: line.lineType,
      serviceId: line.serviceId,
      description: line.description,
      pricingType: line.pricingType,
      requiresQuote: line.requiresQuote,
      unitPrice: line.unitPrice,
      estimate: line.estimatedQuantity === null ? null : fromStoredQuantity(line.estimatedQuantity.toString()),
    }),
  );
  const priced = priceRevisionLines(existing, catalogue, { lines: input.lines, adjustments: input.adjustments });
  if (!priced.ok) {
    // A price for a fixed-price line only comes from a stale or altered
    // page: the editor shows no price field for one.
    const message =
      priced.problem === "LINE_UNAVAILABLE" || priced.problem === "PRICE_NOT_ALLOWED"
        ? ORDER_CHANGED_MESSAGE
        : "Check the highlighted lines and try again.";
    return refuse(fail(priced.problem, message, priced.fieldErrors));
  }

  const hasApprovedQuote = order.approvedQuoteId !== null;
  const built = buildRevision({
    fulfilmentType: order.fulfilmentType,
    lines: priced.lines,
    fulfilment: fulfilment.snapshot,
    hasApprovedQuote,
    reason: input.reason,
  });
  if (!built.ok) {
    const messages = {
      NOT_FULLY_PRICED: "Enter every quantity and the pickup & delivery charge.",
      NEGATIVE_TOTAL: `Discounts can't make the total less than ${formatNaira(0)}.`,
      REASON_REQUIRED: "Add a reason for the customer.",
    };
    return refuse(fail(built.problem, messages[built.problem], { [built.field]: messages[built.problem] }));
  }

  return {
    ok: true as const,
    revision: {
      seenStage: order.stage,
      version: latestVersion + 1,
      fulfilment: fulfilment.fields,
      lines: priced.lines.map(toLineData),
      revision: {
        linesSnapshot: built.linesSnapshot,
        itemsSubtotal: built.itemsSubtotal,
        fulfilmentCharge: built.fulfilmentCharge,
        total: built.total,
        reason: input.reason,
      },
      actorUserId: userId,
      enterQuoteAwaitingApproval: !hasApprovedQuote && entersQuoteAwaitingApproval(order),
    },
  };
}

// The first priced quote moves the order into Quote awaiting approval when
// canTransition allows it as a system move: from Received by store, or from
// Booked for a pickup charge quote.
function entersQuoteAwaitingApproval(order: QuoteOrderRecord): boolean {
  if (order.stage !== "RECEIVED_BY_STORE" && order.stage !== "BOOKED") return false;
  const state = getStageOrderState(order);
  return canTransition(order.stage, "QUOTE_AWAITING_APPROVAL", toContext(state, "SYSTEM", null, false)).allowed;
}

function toLineData(line: PricedOrderLine): NewOrderLineData {
  return {
    lineType: line.lineType,
    serviceId: line.serviceId,
    description: line.description,
    pricingType: line.pricingType,
    requiresQuote: line.requiresQuote,
    unitPrice: line.unitPrice,
    estimatedQuantity: line.estimate === null ? null : toStoredQuantity(line.estimate),
    quantity: line.quantity === null ? null : toStoredQuantity(line.quantity),
    lineTotal: line.lineTotal,
  };
}

// ───────────── Approving and declining (shared) ─────────────

export type DecisionError = "NOT_FOUND" | "CONFLICT" | "NOT_ALLOWED";

export interface QuoteDecisionRequest {
  orderId: string;
  revisionId: string;
  decision: "APPROVE" | "DECLINE";
  // STAFF recording what the customer said, or the CUSTOMER through their
  // link (Feature 14).
  actorType: Extract<ActorType, "STAFF" | "CUSTOMER">;
  customerMessage: string | null;
  // Staff only: who recorded it, and how it was received.
  recordedBy: { userId: string; note: string | null } | null;
}

export type QuoteDecisionResult = { ok: true } | { ok: false; error: DecisionError; reason?: string };

// The one approve/decline operation, for staff here and for customers through
// their link (Feature 14 must call this, never build a second version). It
// succeeds only while the revision is still pending. Returning from Quote
// awaiting approval is a system move: the person is allowed to decide, and
// the stage follows through canTransition as SYSTEM.
export async function decideQuoteRevision(
  storeId: string,
  request: QuoteDecisionRequest,
  now: Date,
): Promise<QuoteDecisionResult> {
  const outcome = await decideRevision<{ error: DecisionError; reason?: string }>(
    storeId,
    request.orderId,
    (order) => planDecision(order, request),
    now,
  );
  switch (outcome.status) {
    case "DECIDED":
      return { ok: true };
    case "NOT_FOUND":
      return { ok: false, error: "NOT_FOUND" };
    case "CONFLICT":
      return { ok: false, error: "CONFLICT" };
    case "REFUSED":
      return { ok: false, ...outcome.refusal };
  }
}

function planDecision(
  order: DecisionOrderRecord,
  request: QuoteDecisionRequest,
): { ok: true; decision: RevisionDecision } | { ok: false; refusal: { error: DecisionError; reason?: string } } {
  const revision = order.quoteRevisions.find((candidate) => candidate.id === request.revisionId);
  if (!revision) return { ok: false, refusal: { error: "NOT_FOUND" } };
  // Already decided, superseded, or an estimate never sent.
  if (!isAwaitingApproval(revision)) return { ok: false, refusal: { error: "CONFLICT" } };

  const approve = request.decision === "APPROVE";
  let returnTo: RevisionDecision["returnTo"] = null;
  if (approve && order.stage === "QUOTE_AWAITING_APPROVAL") {
    const target = order.stageBeforeQuote;
    const check = target
      ? canTransition(order.stage, target, toContext(getStageOrderState(order), "SYSTEM", null, false))
      : { allowed: false as const, reason: "This order doesn't know which stage to return to." };
    if (!check.allowed || !target) return { ok: false, refusal: { error: "NOT_ALLOWED", reason: check.allowed ? undefined : check.reason } };
    returnTo = target;
  }

  return {
    ok: true,
    decision: {
      revisionId: revision.id,
      decision: request.decision,
      actorType: request.actorType,
      customerMessage: approve ? null : request.customerMessage,
      returnTo,
      audit: request.recordedBy && {
        actorUserId: request.recordedBy.userId,
        action: approve ? AUDIT_ACTIONS.approvalRecorded : AUDIT_ACTIONS.declineRecorded,
        note: request.recordedBy.note,
        version: revision.version,
      },
    },
  };
}

// Staff record a decision the customer gave in person or by phone.
export type RecordDecisionResult = { ok: true; message: string } | { ok: false; error: DecisionError; message: string };

export async function recordQuoteDecision(actor: QuoteActor, input: RecordDecisionInput, now: Date): Promise<RecordDecisionResult> {
  const approve = input.decision === "APPROVE";
  const result = await decideQuoteRevision(
    actor.storeId,
    {
      orderId: input.orderId,
      revisionId: input.revisionId,
      decision: input.decision,
      actorType: "STAFF",
      customerMessage: input.decision === "DECLINE" ? input.customerMessage : null,
      recordedBy: { userId: actor.userId, note: input.note },
    },
    now,
  );
  if (result.ok) return { ok: true, message: approve ? "Approval recorded" : "Decline recorded" };
  const messages: Record<DecisionError, string> = {
    NOT_FOUND: ORDER_NOT_FOUND_MESSAGE,
    CONFLICT: ORDER_CHANGED_MESSAGE,
    NOT_ALLOWED: result.reason ?? "This quote can't be approved right now.",
  };
  return { ok: false, error: result.error, message: messages[result.error] };
}

// ───────────── Editing the address ─────────────

export type EditAddressResult = { ok: true; message: string } | { ok: false; error: QuoteError; message: string };

export async function editOrderAddress(actor: QuoteActor, input: EditAddressInput, now: Date): Promise<EditAddressResult> {
  const outcome = await changeOrderAddress(
    actor.storeId,
    input.orderId,
    input.address,
    (order) => {
      if (order.fulfilmentType !== "PICKUP_DELIVERY") return "Only pickup & delivery orders have an address.";
      if (!canReviseQuote(order.stage)) return notRevisableMessage(order.stage, "address");
      return null;
    },
    actor.userId,
    now,
  );
  switch (outcome.status) {
    case "CHANGED":
      return { ok: true, message: "Address updated" };
    case "UNCHANGED":
      return { ok: true, message: "The address is unchanged" };
    case "NOT_FOUND":
      return { ok: false, error: "NOT_FOUND", message: ORDER_NOT_FOUND_MESSAGE };
    case "CONFLICT":
      return { ok: false, error: "CONFLICT", message: ORDER_CHANGED_MESSAGE };
    case "REFUSED":
      return { ok: false, error: "NOT_REVISABLE", message: outcome.refusal };
  }
}
