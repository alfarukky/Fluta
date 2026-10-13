import "server-only";

import type { FulfilmentType, OrderStage, PickupWindowStatus, StoreRole } from "@/generated/prisma/client";
import { isAwaitingApproval, type RevisionStatus } from "@/lib/orders";
import type { AvailableTransitions, StageMove, StageMoveKind } from "@/types/orders";

// Order stages: the only place that decides whether an order may move from
// one stage to another (the overview's "Allowed transitions" table). Pure:
// the caller passes everything the rules need. Every stage change, in this
// feature and later ones (quotes, online bookings, tracking links), asks
// canTransition first.

// Who is making the move. OWNER and STAFF are store members pressing a
// button; CUSTOMER acts through a tracking link; SYSTEM is a move another
// action makes automatically (issuing or approving a quote).
export type StageActor = StoreRole | "CUSTOMER" | "SYSTEM";

export interface TransitionContext {
  fulfilmentType: FulfilmentType;
  actor: StageActor;
  hasApprovedQuote: boolean;
  // A revision has been sent and is waiting for the customer's approval.
  hasRevisionAwaitingApproval: boolean;
  note: string | null; // trimmed; null when empty
  // The order's first stage (its first timeline entry).
  startingStage: OrderStage;
  // For a completed order: the stage it was completed from.
  completedFromStage: OrderStage | null;
  // Pickup order at Ready handed to the customer in person instead of delivered.
  collectedByCustomer: boolean;
  // Where an order in Quote awaiting approval returns once approved.
  stageBeforeQuote: OrderStage | null;
  // The pickup window is confirmed (staff) or accepted (customer).
  pickupWindowConfirmed: boolean;
}

export type TransitionDenial = "NOTE_REQUIRED" | "NOT_ALLOWED";

export type TransitionResult = { allowed: true } | { allowed: false; code: TransitionDenial; reason: string };

const CLOSED: readonly OrderStage[] = ["COMPLETED", "CANCELLED"];
const PICKUP_ONLY_STAGES: readonly OrderStage[] = ["PICKUP_SCHEDULED", "PICKED_UP", "OUT_FOR_DELIVERY"];

// Step back always goes to this stage, never to whatever the latest event
// says, so pressing it twice goes back two stages.
export function getPreviousStage(stage: OrderStage, fulfilmentType: FulfilmentType): OrderStage | null {
  const pickup = fulfilmentType === "PICKUP_DELIVERY";
  if (!pickup && PICKUP_ONLY_STAGES.includes(stage)) return null;
  switch (stage) {
    case "PICKUP_SCHEDULED":
      return "BOOKED";
    case "PICKED_UP":
      return "PICKUP_SCHEDULED";
    case "RECEIVED_BY_STORE":
      return pickup ? "PICKED_UP" : "BOOKED";
    case "IN_PROGRESS":
      return "RECEIVED_BY_STORE";
    case "READY":
      return "IN_PROGRESS";
    case "OUT_FOR_DELIVERY":
      return "READY";
    default:
      return null;
  }
}

const allow = (): TransitionResult => ({ allowed: true });
const deny = (reason: string): TransitionResult => ({ allowed: false, code: "NOT_ALLOWED", reason });
const NOTE_REQUIRED: TransitionResult = { allowed: false, code: "NOTE_REQUIRED", reason: "Add a note to explain this change." };

const isMember = (actor: StageActor) => actor === "OWNER" || actor === "STAFF";
const AWAITING_REVISION = "Waiting for the customer to approve the revised total.";

export function canTransition(from: OrderStage, to: OrderStage, context: TransitionContext): TransitionResult {
  if (from === "CANCELLED") return deny("This order is cancelled. Cancelled orders can't be changed.");
  if (from === to) return deny("The order is already at this stage.");

  const pickup = context.fulfilmentType === "PICKUP_DELIVERY";

  if (to === "CANCELLED") {
    if (!isMember(context.actor)) return deny("Only the store can cancel an order.");
    if (from === "COMPLETED") return deny("A completed order can't be cancelled.");
    if (context.actor === "STAFF" && !context.note) return NOTE_REQUIRED;
    return allow();
  }

  // Reopening a completed order: owners only, back to where it was completed from.
  if (from === "COMPLETED") {
    if (context.actor !== "OWNER") return deny("Only the owner can reopen a completed order.");
    if (to !== context.completedFromStage) return deny("A completed order can only go back to the stage it was completed from.");
    if (!context.note) return NOTE_REQUIRED;
    return allow();
  }

  // Moving forward.
  const forward = checkForward(from, to, context, pickup);
  if (forward) return forward;

  // Stepping back one stage to fix a mistake.
  if (to === getPreviousStage(from, context.fulfilmentType)) {
    if (!isMember(context.actor)) return deny("Only the store can step an order back.");
    if (from === context.startingStage) return deny("This is the stage the order started at, so it can't step back.");
    if (!context.note) return NOTE_REQUIRED;
    return allow();
  }

  return deny("This order can't move to that stage from here.");
}

// The forward moves (and the automatic quote moves). Null when `to` isn't a
// forward move from `from`, so the caller tries stepping back instead.
function checkForward(
  from: OrderStage,
  to: OrderStage,
  context: TransitionContext,
  pickup: boolean,
): TransitionResult | null {
  const { actor } = context;

  switch (`${from}>${to}`) {
    case "BOOKED>PICKUP_SCHEDULED":
      if (!pickup) return deny("Only pickup orders are scheduled for pickup.");
      if (actor === "SYSTEM") return deny("Pickup is scheduled by staff or by the customer accepting a window.");
      if (context.hasRevisionAwaitingApproval) return deny("Waiting for the customer to approve the pickup charge.");
      if (!context.pickupWindowConfirmed) return deny("Waiting for the pickup window to be confirmed.");
      return allow();

    case "BOOKED>QUOTE_AWAITING_APPROVAL":
      if (!pickup) return deny("Only pickup orders need a pickup charge approved before pickup.");
      if (actor !== "SYSTEM") return deny("This happens when staff send the pickup charge for approval.");
      return allow();

    case "RECEIVED_BY_STORE>QUOTE_AWAITING_APPROVAL":
      if (actor !== "SYSTEM") return deny("This happens when staff send a priced quote.");
      return allow();

    case "BOOKED>RECEIVED_BY_STORE":
      if (pickup) return deny("A pickup order is received after it has been picked up.");
      return memberOnly(actor);

    case "PICKUP_SCHEDULED>PICKED_UP":
    case "PICKED_UP>RECEIVED_BY_STORE":
      if (!pickup) return deny("Only pickup orders are picked up.");
      return memberOnly(actor);

    case "RECEIVED_BY_STORE>IN_PROGRESS":
      if (!isMember(actor)) return deny("Only the store can start work.");
      if (!context.hasApprovedQuote) return deny("Waiting for the quote to be approved.");
      if (context.hasRevisionAwaitingApproval) return deny(AWAITING_REVISION);
      return allow();

    case "IN_PROGRESS>READY":
      return memberOnly(actor);

    case "READY>OUT_FOR_DELIVERY":
      if (!pickup) return deny("Only pickup orders go out for delivery.");
      return memberOnly(actor);

    case "READY>COMPLETED":
      if (!isMember(actor)) return deny("Only the store can complete an order.");
      if (pickup && !context.collectedByCustomer) return deny("Send the order out for delivery first.");
      if (context.hasRevisionAwaitingApproval) return deny(AWAITING_REVISION);
      if (pickup && !context.note) return NOTE_REQUIRED;
      return allow();

    case "OUT_FOR_DELIVERY>COMPLETED":
      if (!pickup) return deny("Only pickup orders go out for delivery.");
      if (!isMember(actor)) return deny("Only the store can complete an order.");
      if (context.hasRevisionAwaitingApproval) return deny(AWAITING_REVISION);
      return allow();
  }

  // Quote approved: back to where the order was before the quote.
  if (from === "QUOTE_AWAITING_APPROVAL" && !CLOSED.includes(to)) {
    if (to !== context.stageBeforeQuote) return deny("Waiting for the customer to approve the quote.");
    if (actor !== "CUSTOMER" && actor !== "SYSTEM") return deny("Waiting for the customer to approve the quote.");
    return allow();
  }
  return null;
}

function memberOnly(actor: StageActor): TransitionResult {
  return isMember(actor) ? allow() : deny("Only the store can make this change.");
}

// ───────────── The moves offered on an order ─────────────

// The moves the order detail page offers (types in src/types/orders.ts, so
// the page's client components can use them too).
export type { AvailableTransitions, StageMove, StageMoveKind };

// Everything canTransition needs about the order itself.
export type StageOrderState = Omit<TransitionContext, "actor" | "note" | "collectedByCustomer"> & { stage: OrderStage };

// This feature's forward move from each stage.
function getAdvanceStage(stage: OrderStage, fulfilmentType: FulfilmentType): OrderStage | null {
  const pickup = fulfilmentType === "PICKUP_DELIVERY";
  switch (stage) {
    case "BOOKED":
      return pickup ? null : "RECEIVED_BY_STORE";
    case "PICKUP_SCHEDULED":
      return "PICKED_UP";
    case "PICKED_UP":
      return "RECEIVED_BY_STORE";
    case "RECEIVED_BY_STORE":
      return "IN_PROGRESS";
    case "IN_PROGRESS":
      return "READY";
    case "READY":
      return pickup ? "OUT_FOR_DELIVERY" : "COMPLETED";
    case "OUT_FOR_DELIVERY":
      return "COMPLETED";
    default:
      return null;
  }
}

// The next stage on the order's path when it belongs to a later feature, so
// the page can still say what the order is waiting for.
function getLaterFeatureNextStage(order: StageOrderState): OrderStage | null {
  if (order.stage === "BOOKED" && order.fulfilmentType === "PICKUP_DELIVERY") return "PICKUP_SCHEDULED";
  if (order.stage === "QUOTE_AWAITING_APPROVAL") return order.stageBeforeQuote ?? "RECEIVED_BY_STORE";
  return null;
}

export function getAvailableTransitions(order: StageOrderState, actor: StoreRole): AvailableTransitions {
  const pickup = order.fulfilmentType === "PICKUP_DELIVERY";
  const candidates: { kind: StageMoveKind; to: OrderStage | null; collectedByCustomer?: boolean }[] = [
    { kind: "ADVANCE", to: getAdvanceStage(order.stage, order.fulfilmentType) },
    { kind: "COLLECTED_INSTEAD", to: pickup && order.stage === "READY" ? "COMPLETED" : null, collectedByCustomer: true },
    { kind: "STEP_BACK", to: getPreviousStage(order.stage, order.fulfilmentType) },
    { kind: "CANCEL", to: "CANCELLED" },
    { kind: "REOPEN", to: order.stage === "COMPLETED" ? order.completedFromStage : null },
  ];

  let primary: StageMove | null = null;
  let blockedReason: string | null = null;
  const secondary: StageMove[] = [];

  for (const candidate of candidates) {
    if (!candidate.to) continue;
    const collectedByCustomer = candidate.collectedByCustomer ?? false;
    const result = checkMove(order, actor, candidate.to, collectedByCustomer);
    if (!result.allowed) {
      if (candidate.kind === "ADVANCE") blockedReason = result.reason;
      continue;
    }
    const move = { kind: candidate.kind, to: candidate.to, collectedByCustomer, noteRequired: result.noteRequired };
    if (candidate.kind === "ADVANCE") primary = move;
    else secondary.push(move);
  }

  const later = getLaterFeatureNextStage(order);
  if (!primary && !blockedReason && later) {
    const result = canTransition(order.stage, later, toContext(order, actor, null, false));
    if (!result.allowed) blockedReason = result.reason;
  }

  return { primary, secondary, blockedReason };
}

// The offered move from the order's stage to `to`, or null when this feature
// doesn't offer it (or canTransition refuses it, whatever the note).
export function findAvailableMove(
  order: StageOrderState,
  actor: StoreRole,
  to: OrderStage,
  collectedByCustomer: boolean,
): StageMove | null {
  const { primary, secondary } = getAvailableTransitions(order, actor);
  return (
    [primary, ...secondary].find(
      (move) => move !== null && move.to === to && move.collectedByCustomer === collectedByCustomer,
    ) ?? null
  );
}

export function toContext(
  order: StageOrderState,
  actor: StageActor,
  note: string | null,
  collectedByCustomer: boolean,
): TransitionContext {
  return {
    fulfilmentType: order.fulfilmentType,
    actor,
    hasApprovedQuote: order.hasApprovedQuote,
    hasRevisionAwaitingApproval: order.hasRevisionAwaitingApproval,
    note,
    startingStage: order.startingStage,
    completedFromStage: order.completedFromStage,
    collectedByCustomer,
    stageBeforeQuote: order.stageBeforeQuote,
    pickupWindowConfirmed: order.pickupWindowConfirmed,
  };
}

// Allowed with no note, or only with one; refused otherwise.
function checkMove(
  order: StageOrderState,
  actor: StoreRole,
  to: OrderStage,
  collectedByCustomer: boolean,
): { allowed: true; noteRequired: boolean } | { allowed: false; reason: string } {
  const withoutNote = canTransition(order.stage, to, toContext(order, actor, null, collectedByCustomer));
  if (withoutNote.allowed) return { allowed: true, noteRequired: false };
  if (withoutNote.code !== "NOTE_REQUIRED") return withoutNote;
  const withNote = canTransition(order.stage, to, toContext(order, actor, "note", collectedByCustomer));
  return withNote.allowed ? { allowed: true, noteRequired: true } : withNote;
}

// The order as stored, for getStageOrderState.
export interface StageOrderRecord {
  stage: OrderStage;
  fulfilmentType: FulfilmentType;
  stageBeforeQuote: OrderStage | null;
  pickupWindowStatus: PickupWindowStatus | null;
  approvedQuoteId: string | null;
  quoteRevisions: readonly RevisionStatus[];
  // Every status event, in any order.
  statusEvents: readonly { id: string; fromStage: OrderStage | null; toStage: OrderStage; createdAt: Date }[];
}

// What canTransition needs about an order, worked out from its record.
export function getStageOrderState(order: StageOrderRecord): StageOrderState {
  const events = [...order.statusEvents].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const completion = events.findLast((event) => event.toStage === "COMPLETED");
  return {
    stage: order.stage,
    fulfilmentType: order.fulfilmentType,
    hasApprovedQuote: order.approvedQuoteId !== null,
    hasRevisionAwaitingApproval: order.quoteRevisions.some(isAwaitingApproval),
    startingStage: events[0]?.toStage ?? order.stage,
    completedFromStage: order.stage === "COMPLETED" ? (completion?.fromStage ?? null) : null,
    stageBeforeQuote: order.stageBeforeQuote,
    pickupWindowConfirmed: order.pickupWindowStatus === "CONFIRMED",
  };
}
