import "server-only";

import { cache } from "react";

import { getBookingPriceSummary } from "@/lib/booking";
import { formatNaira } from "@/lib/money";
import type { OrderStage } from "@/generated/prisma/client";
import { CLOSED_STAGES, formatOrderNumber } from "@/lib/orders";
import { maskPhone } from "@/lib/phone";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import { formatQuantity, fromDecimalString, isWeighed } from "@/lib/quantity";
import { findPendingRevision, formatDifference, getTotalDifference } from "@/lib/quotes";
import { formatCalendarDate, formatDateTime, toDateKey } from "@/lib/time";
import { getTrackingLinkStatus, hashToken, isWellFormedToken } from "@/lib/tokens";
import { getCustomerPaymentText, getCustomerStageLabel, getCustomerTimeline } from "@/lib/tracking";
import { ADJUSTMENT_KIND_LABELS } from "@/schemas/orders";
import { acceptPickupSuggestion, findLatestPickupSuggestion, type PickupOrderRecord } from "@/server/data/pickup-times";
import { findTrackedOrder, type TrackedOrderRecord } from "@/server/data/tracking";
import { getBalance, type Balance } from "@/server/domain/balance";
import { canTransition, getStageOrderState, toContext } from "@/server/domain/order-stages";
import type { QuoteSnapshot } from "@/server/domain/orders";
import type {
  PriceUpdateReview,
  TrackingItem,
  TrackingPage,
  TrackingPickup,
  TrackingPrice,
  TrackingTimelineStep,
  TrackingView,
} from "@/types/tracking";

import { toPublicStore } from "./booking";
import { decideQuoteRevision } from "./quotes";

// Guest tracking (/o/{token}): the page, and the customer's actions. The
// token is the only credential. It is hashed and looked up exactly, and only
// that one order (and its store) is ever read or changed. The store always
// comes from the order, never from the request. Every action checks the
// token again, and the link's validity, on the server.

export const TRACKING_MESSAGES = {
  // An unknown link, or one replaced by a newer message: only the current
  // token's hash is kept, so the two can't be told apart.
  invalid: "This link may have been replaced by a newer message from the store. Please open the latest message, or call the store.",
  unavailable: "This order is no longer available.",
  expired: (storeName: string) => `This link has expired. Please contact ${storeName}.`,
  priceNotCurrent: "This price update is no longer current.",
  orderChanged: "This order was just updated. Please check the latest details.",
} as const;

// ───────────── The page ─────────────

// One lookup per request, shared by the page and its metadata.
export const loadTrackingPage = cache(async (token: string, now: Date = new Date()): Promise<TrackingPage> => {
  if (!isWellFormedToken(token)) return { kind: "NOT_FOUND" };
  const order = await findTrackedOrder(hashToken(token));
  if (!order) return { kind: "NOT_FOUND" };

  const balance = getBalance(order);
  const status = getTrackingLinkStatus(
    {
      storeStatus: order.store.status,
      stage: order.stage,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
      paymentState: balance.state,
    },
    now,
  );
  if (status === "STORE_DEACTIVATED") return { kind: "UNAVAILABLE" };
  if (status === "EXPIRED") {
    const { name, phone } = toPublicStore(order.store);
    return { kind: "EXPIRED", storeName: name, storePhone: phone, storePhoneHref: order.store.phone ? `tel:${order.store.phone}` : null };
  }
  const suggestion =
    order.pickupWindowStatus === "PROPOSED_BY_STORE" ? await findLatestPickupSuggestion(order.storeId, order.id) : null;
  return { kind: "VALID", view: buildView(order, balance, suggestion) };
});

const CLOSED: ReadonlySet<OrderStage> = new Set(CLOSED_STAGES);

function buildView(
  order: TrackedOrderRecord,
  balance: Balance,
  suggestion: Awaited<ReturnType<typeof findLatestPickupSuggestion>>,
): TrackingView {
  const timeZone = order.store.timeZone;
  const closed = CLOSED.has(order.stage);
  const pending = closed ? null : findPendingRevision(order.quoteRevisions);
  const awaitingCustomer = !closed && order.stage === "BOOKED" && order.pickupWindowStatus === "PROPOSED_BY_STORE";

  return {
    store: toPublicStore(order.store),
    displayNumber: formatOrderNumber(order.store, order.orderNumber),
    stageLabel: getCustomerStageLabel(order.stage, order.fulfilmentType),
    closed,
    timeline: buildTimeline(order, timeZone),
    payment: getCustomerPaymentText(balance),
    price: buildPrice(order),
    pickup: buildPickup(order),
    maskedPhone: maskPhone(order.customer.phone),
    priceUpdate: pending ? buildPriceUpdate(order, pending) : null,
    pickupSuggestion:
      awaitingCustomer && suggestion && order.scheduledPickupDate
        ? {
            suggestionId: suggestion.id,
            date: formatCalendarDate(toDateKey(order.scheduledPickupDate)),
            time: formatWindow(order.scheduledWindowStart, order.scheduledWindowEnd) ?? "",
            requested: order.requestedPickupDate
              ? [formatCalendarDate(toDateKey(order.requestedPickupDate)), formatWindow(order.requestedWindowStart, order.requestedWindowEnd)]
                  .filter(Boolean)
                  .join(" · ")
              : null,
          }
        : null,
  } satisfies TrackingView;
}

function buildTimeline(order: TrackedOrderRecord, timeZone: string): TrackingTimelineStep[] {
  const state = getStageOrderState(order);
  const events = [...order.statusEvents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const cancellation = events.findLast((event) => event.toStage === "CANCELLED");
  const steps = getCustomerTimeline({
    fulfilmentType: order.fulfilmentType,
    stage: order.stage,
    startingStage: state.startingStage,
    stageBeforeQuote: order.stageBeforeQuote,
    completedFromStage: state.completedFromStage,
    cancelledFromStage: cancellation?.fromStage ?? null,
  });
  return steps.map((step) => {
    const reached = step.state === "upcoming" ? undefined : events.findLast((event) => event.toStage === step.stage);
    return { key: step.stage, label: step.label, state: step.state, at: reached ? formatDateTime(reached.createdAt, timeZone) : null };
  });
}

// ───────────── Prices ─────────────

// Prices only ever come from the approved price (its frozen snapshot), never
// the working lines or today's catalogue. Before anything is approved: the
// items, and the booking's estimate rule (an estimated total only when every
// part can be estimated). Once the store has sent a price, it's the store's
// to confirm.
function buildPrice(order: TrackedOrderRecord): TrackingPrice {
  if (order.approvedQuote) {
    const snapshot = order.approvedQuote.linesSnapshot as QuoteSnapshot;
    return {
      kind: "approved",
      items: snapshotItems(snapshot),
      charge: order.fulfilmentType === "PICKUP_DELIVERY" ? formatNaira(snapshot.fulfilmentCharge ?? 0) : null,
      total: formatNaira(order.approvedQuote.total),
    };
  }

  const services = order.lines.filter((line) => line.lineType === "SERVICE");
  const items = services.map(
    (line): TrackingItem => ({ key: line.id, name: line.description, detail: describeUnpricedLine(line), amount: null }),
  );
  // A price the store has sent (approved or not) replaces the booking's estimate.
  const storePriced = order.quoteRevisions.some((revision) => revision.version > 1);
  if (storePriced) return { kind: "unknown", items };

  const summary = getBookingPriceSummary({
    fulfilmentType: order.fulfilmentType,
    lines: services.map((line) => ({
      price: line.unitPrice ?? 0,
      pricingType: line.pricingType ?? "PER_ITEM",
      requiresQuote: line.requiresQuote,
      quantity: toHundredths(line.quantity),
      estimate: toHundredths(line.estimatedQuantity),
    })),
    fulfilmentCharge: order.fulfilmentCharge,
  });
  if (summary.kind === "unknown") return { kind: "unknown", items };
  const others = order.lines.reduce((sum, line) => sum + (line.lineType === "ADJUSTMENT" ? (line.lineTotal ?? 0) : 0), 0);
  return { kind: "estimate", items, total: formatNaira(summary.total + others) };
}

function toHundredths(value: { toString(): string } | null): number | null {
  return value === null ? null : fromDecimalString(value.toString());
}

type ServiceLine = TrackedOrderRecord["lines"][number];

function describeUnpricedLine(line: ServiceLine): string | null {
  const pricingType = line.pricingType ?? "PER_ITEM";
  const quantity = toHundredths(line.quantity);
  // "× 2" for items or packages, "3.5 kg" for a weight.
  if (quantity !== null) return isWeighed(pricingType) ? formatQuantity(quantity, pricingType) : `× ${formatQuantity(quantity, pricingType)}`;
  const estimate = toHundredths(line.estimatedQuantity);
  const what = pricingType === "PER_KG" ? "weigh" : "count";
  if (estimate !== null) return `About ${formatQuantity(estimate, pricingType)}. The store will ${what} it.`;
  return `The store will ${what} it.`;
}

function snapshotItems(snapshot: QuoteSnapshot): TrackingItem[] {
  return snapshot.lines.map((line, index): TrackingItem => {
    if (line.lineType === "ADJUSTMENT") {
      return {
        key: `${index}`,
        name: line.description,
        detail: line.lineTotal < 0 ? ADJUSTMENT_KIND_LABELS.DISCOUNT : ADJUSTMENT_KIND_LABELS.CHARGE,
        amount: formatNaira(line.lineTotal),
      };
    }
    const quantity = line.quantity === null ? null : fromDecimalString(line.quantity);
    const detail =
      quantity === null ? null : `${formatQuantity(quantity, line.pricingType ?? "PER_ITEM")} × ${formatNaira(line.unitPrice ?? 0)}`;
    return { key: `${index}`, name: line.description, detail, amount: formatNaira(line.lineTotal) };
  });
}

type Revision = TrackedOrderRecord["quoteRevisions"][number];

function buildPriceUpdate(order: TrackedOrderRecord, revision: Revision): PriceUpdateReview {
  const snapshot = revision.linesSnapshot as QuoteSnapshot;
  const previous = order.approvedQuote?.total ?? null;
  const difference = getTotalDifference(previous, revision.total);
  return {
    revisionId: revision.id,
    previousTotal: previous === null ? null : formatNaira(previous),
    newTotal: formatNaira(revision.total),
    difference: difference === null ? null : formatDifference(difference),
    direction: difference === null ? null : difference > 0 ? "up" : difference < 0 ? "down" : "same",
    reason: revision.reason,
    items: snapshotItems(snapshot),
    charge: order.fulfilmentType === "PICKUP_DELIVERY" ? formatNaira(snapshot.fulfilmentCharge ?? 0) : null,
  };
}

// ───────────── Pickup ─────────────

const PICKUP_STATUS_LABELS = {
  REQUESTED: "Requested",
  PROPOSED_BY_STORE: "Suggested by the store",
  CONFIRMED: "Confirmed",
} as const;

// The area (the order's own copy), date, and time. Never the address.
function buildPickup(order: TrackedOrderRecord): TrackingPickup | null {
  if (order.fulfilmentType !== "PICKUP_DELIVERY" || !order.pickupWindowStatus) return null;
  const requested = order.pickupWindowStatus === "REQUESTED";
  const date = requested ? order.requestedPickupDate : order.scheduledPickupDate;
  if (!date) return null;
  return {
    area: order.serviceAreaName,
    date: formatCalendarDate(toDateKey(date)),
    time: requested
      ? formatWindow(order.requestedWindowStart, order.requestedWindowEnd)
      : formatWindow(order.scheduledWindowStart, order.scheduledWindowEnd),
    status: PICKUP_STATUS_LABELS[order.pickupWindowStatus],
  };
}

function formatWindow(start: string | null, end: string | null): string | null {
  return start && end ? formatPickupWindow({ start, end }) : null;
}

// ───────────── Customer actions ─────────────

export type CustomerActionResult = { ok: true; message: string } | { ok: false; message: string };

type ActionableOrder = { ok: true; order: TrackedOrderRecord; tokenHash: string } | { ok: false; message: string };

// The token's order, if the customer may act on it now: the link works, and
// the order isn't completed or cancelled.
async function findActionableOrder(token: string, now: Date): Promise<ActionableOrder> {
  if (!isWellFormedToken(token)) return { ok: false, message: TRACKING_MESSAGES.invalid };
  const tokenHash = hashToken(token);
  const order = await findTrackedOrder(tokenHash);
  if (!order) return { ok: false, message: TRACKING_MESSAGES.invalid };

  const status = getTrackingLinkStatus(
    {
      storeStatus: order.store.status,
      stage: order.stage,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
      paymentState: getBalance(order).state,
    },
    now,
  );
  if (status === "STORE_DEACTIVATED") return { ok: false, message: TRACKING_MESSAGES.unavailable };
  if (status === "EXPIRED") return { ok: false, message: TRACKING_MESSAGES.expired(order.store.name) };
  if (order.stage === "COMPLETED") return { ok: false, message: "This order is completed, so it can't be changed." };
  if (order.stage === "CANCELLED") return { ok: false, message: "This order is cancelled, so it can't be changed." };
  return { ok: true, order, tokenHash };
}

// Approving or declining a price update. No approval logic of its own: Feature
// 12's shared operation decides, with the customer as the actor. It succeeds
// only while the update is still pending. Approving never schedules a pickup.
export async function decidePriceUpdate(
  token: string,
  request: { revisionId: string; decision: "APPROVE" | "DECLINE"; message: string | null },
  now: Date,
): Promise<CustomerActionResult> {
  const found = await findActionableOrder(token, now);
  if (!found.ok) return found;
  const { order } = found;

  const result = await decideQuoteRevision(
    order.storeId,
    {
      orderId: order.id,
      revisionId: request.revisionId,
      decision: request.decision,
      actorType: "CUSTOMER",
      customerMessage: request.decision === "DECLINE" ? request.message : null,
      recordedBy: null,
    },
    now,
  );
  if (result.ok) {
    return {
      ok: true,
      message: request.decision === "APPROVE" ? "Thank you. You approved the new price." : "Thank you. We've let the store know.",
    };
  }
  if (result.error === "NOT_ALLOWED") return { ok: false, message: TRACKING_MESSAGES.orderChanged };
  return { ok: false, message: TRACKING_MESSAGES.priceNotCurrent };
}

// Accepting the pickup time the store suggested: only the latest suggestion,
// and only while it is still the current one.
export async function acceptSuggestedPickup(token: string, suggestionId: string, now: Date): Promise<CustomerActionResult> {
  const found = await findActionableOrder(token, now);
  if (!found.ok) return found;

  const outcome = await acceptPickupSuggestion<string>(found.tokenHash, { id: suggestionId }, checkCustomerAccept, now);
  switch (outcome.status) {
    case "CHANGED":
      return { ok: true, message: "Thank you. Your pickup time is confirmed." };
    case "NOT_FOUND":
      return { ok: false, message: TRACKING_MESSAGES.invalid };
    case "CONFLICT":
      return { ok: false, message: TRACKING_MESSAGES.orderChanged };
    case "REFUSED":
      return { ok: false, message: outcome.refusal };
  }
}

function checkCustomerAccept(order: PickupOrderRecord): string | null {
  if (order.stage !== "BOOKED" || order.pickupWindowStatus !== "PROPOSED_BY_STORE") return TRACKING_MESSAGES.orderChanged;
  const state = { ...getStageOrderState(order), pickupWindowConfirmed: true };
  if (state.hasRevisionAwaitingApproval) return "Please review the price update first.";
  const check = canTransition("BOOKED", "PICKUP_SCHEDULED", toContext(state, "CUSTOMER", null, false));
  return check.allowed ? null : TRACKING_MESSAGES.orderChanged;
}
