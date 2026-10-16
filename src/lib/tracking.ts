import type { FulfilmentType, OrderStage } from "@/generated/prisma/enums";

import { formatNaira } from "./money";
import type { PaymentState } from "./orders";

// What customers see on their tracking page, in plain words. Staff screens
// use the overview's terms (src/lib/orders.ts); customers never see "quote",
// "revision", or "version".

const CUSTOMER_STAGE_LABELS: Record<OrderStage, string> = {
  BOOKED: "Booking received",
  PICKUP_SCHEDULED: "Pickup scheduled",
  PICKED_UP: "Picked up",
  RECEIVED_BY_STORE: "At the store",
  QUOTE_AWAITING_APPROVAL: "Waiting for your approval",
  IN_PROGRESS: "Being cleaned",
  READY: "Ready",
  OUT_FOR_DELIVERY: "On its way",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// A drop-off order is ready to collect; a pickup order is ready to deliver.
export function getCustomerStageLabel(stage: OrderStage, fulfilmentType: FulfilmentType): string {
  if (stage === "READY" && fulfilmentType === "DROP_OFF") return "Ready for collection";
  return CUSTOMER_STAGE_LABELS[stage];
}

// The payment line, from getBalance's state and balance (kobo, null while
// awaiting a price).
export function getCustomerPaymentText(balance: { state: PaymentState; balanceKobo: number | null }): string {
  switch (balance.state) {
    case "PAID":
      return "Paid";
    case "OUTSTANDING":
      return `Balance due: ${formatNaira(balance.balanceKobo ?? 0)}`;
    case "REFUND_OWED":
      return `The store will refund ${formatNaira(-(balance.balanceKobo ?? 0))}`;
    case "NOTHING_DUE":
      return "Nothing due";
    case "AWAITING_QUOTE":
      return "The store will confirm the price";
  }
}

// ───────────── The progress timeline ─────────────

export type CustomerTimelineState = "done" | "current" | "upcoming";

export interface CustomerTimelineStep {
  stage: OrderStage;
  label: string;
  state: CustomerTimelineState;
}

export interface CustomerTimelineOrder {
  fulfilmentType: FulfilmentType;
  stage: OrderStage;
  // The order's first stage: a counter drop-off starts at Received by store,
  // a staff-entered pickup at Pickup scheduled.
  startingStage: OrderStage;
  // Where an order waiting for the customer's approval returns once approved.
  stageBeforeQuote: OrderStage | null;
  // For a completed order: the stage it was completed from.
  completedFromStage: OrderStage | null;
  // For a cancelled order: the stage it was cancelled from.
  cancelledFromStage: OrderStage | null;
}

const PICKUP_PATH: readonly OrderStage[] = [
  "BOOKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "RECEIVED_BY_STORE",
  "IN_PROGRESS",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
];
const DROP_OFF_PATH: readonly OrderStage[] = ["BOOKED", "RECEIVED_BY_STORE", "IN_PROGRESS", "READY", "COMPLETED"];

// The progress shown on the tracking page (✓ done, ● current, ○ upcoming),
// with only the stages this order's type uses, from where it started.
// - Waiting for the customer's approval isn't a step: progress stays where the
//   order was (done up to stageBeforeQuote), and the page shows the approval
//   as its action card, so customers never see their progress go backwards.
// - A pickup order the customer collected skips "On its way".
// - A cancelled order keeps the steps it reached, then ends at Cancelled.
export function getCustomerTimeline(order: CustomerTimelineOrder): CustomerTimelineStep[] {
  const fullPath = order.fulfilmentType === "PICKUP_DELIVERY" ? PICKUP_PATH : DROP_OFF_PATH;
  const start = Math.max(fullPath.indexOf(order.startingStage), 0);
  let path = fullPath.slice(start);
  if (order.stage === "COMPLETED" && order.fulfilmentType === "PICKUP_DELIVERY" && order.completedFromStage === "READY") {
    path = path.filter((stage) => stage !== "OUT_FOR_DELIVERY");
  }
  const step = (stage: OrderStage, state: CustomerTimelineState): CustomerTimelineStep => ({
    stage,
    label: getCustomerStageLabel(stage, order.fulfilmentType),
    state,
  });

  if (order.stage === "CANCELLED") {
    const reached = order.cancelledFromStage === "QUOTE_AWAITING_APPROVAL" ? order.stageBeforeQuote : order.cancelledFromStage;
    const reachedIndex = reached ? path.indexOf(reached) : -1;
    return [...path.slice(0, reachedIndex + 1).map((stage) => step(stage, "done")), step("CANCELLED", "current")];
  }

  if (order.stage === "COMPLETED") return path.map((stage) => step(stage, "done"));

  if (order.stage === "QUOTE_AWAITING_APPROVAL") {
    const doneIndex = order.stageBeforeQuote ? path.indexOf(order.stageBeforeQuote) : -1;
    return path.map((stage, index) => step(stage, index <= doneIndex ? "done" : "upcoming"));
  }

  const currentIndex = path.indexOf(order.stage);
  return path.map((stage, index) => step(stage, index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming"));
}
