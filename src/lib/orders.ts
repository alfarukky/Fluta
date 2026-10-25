import type {
  ActorType,
  FulfilmentType,
  OrderChannel,
  OrderStage,
  PaymentMethod,
  PricingType,
  QuoteStatus,
} from "@/generated/prisma/enums";

import { formatQuantity } from "./quantity";

// Order wording and the rules both the new-order form (its review) and the
// server use. src/server/domain/orders.ts re-exports the rules for the server.

// The overview's terms, exactly.
export const ORDER_STAGE_LABELS: Record<OrderStage, string> = {
  BOOKED: "Booked",
  PICKUP_SCHEDULED: "Pickup scheduled",
  PICKED_UP: "Picked up",
  RECEIVED_BY_STORE: "Received by store",
  QUOTE_AWAITING_APPROVAL: "Quote awaiting approval",
  IN_PROGRESS: "In progress",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  ONLINE: "Online",
  COUNTER: "Counter",
  PHONE: "Phone",
  WHATSAPP: "WhatsApp",
};

// The channels staff enter orders for; Online is customer bookings only.
export const STAFF_CHANNELS = ["COUNTER", "PHONE", "WHATSAPP"] as const satisfies readonly OrderChannel[];
export type StaffChannel = (typeof STAFF_CHANNELS)[number];

export const FULFILMENT_TYPE_LABELS: Record<FulfilmentType, string> = {
  DROP_OFF: "Drop-off",
  PICKUP_DELIVERY: "Pickup & delivery",
};

// Payment states the workspace shows, worked out by getBalance
// (src/server/domain/balance.ts). Payment required and Pending come with
// online payments (Features 13 and 17).
// Nothing due: a cancelled order with nothing collected (or everything
// refunded), so "Paid" always means the customer settled an approved total.
export const PAYMENT_STATES = [
  "AWAITING_QUOTE",
  "PAYMENT_REQUIRED",
  "PENDING",
  "PAID",
  "OUTSTANDING",
  "REFUND_OWED",
  "NOTHING_DUE",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  AWAITING_QUOTE: "Awaiting quote",
  PAYMENT_REQUIRED: "Payment required",
  PENDING: "Pending",
  PAID: "Paid",
  OUTSTANDING: "Outstanding",
  REFUND_OWED: "Refund owed",
  NOTHING_DUE: "Nothing due",
};

// Open orders: anything not Completed or Cancelled.
export const CLOSED_STAGES = ["COMPLETED", "CANCELLED"] as const satisfies readonly OrderStage[];

// "FF-1024". The one way an order number is shown; never build it by hand.
// The prefix is display-only, so changing it never changes stored numbers.
export function formatOrderNumber(store: { orderPrefix: string }, orderNumber: number): string {
  return `${store.orderPrefix}-${orderNumber}`;
}

// The order number in a search, or null. The text is trimmed, spaces and
// hyphens removed, and uppercased; it is a number only if it is digits,
// optionally after letters, so "1024", "FF-1024", "ff1024", and " ff - 1024 "
// all give 1024. Letters that aren't the store's prefix ("CW1024" at
// FreshFold) give null, as does anything longer than an order number can be.
export function parseOrderNumberSearch(text: string, orderPrefix: string): number | null {
  const match = /^([A-Z]*)(\d{1,9})$/.exec(text.replace(/[\s-]/g, "").toUpperCase());
  if (!match) return null;
  const [, letters, digits] = match;
  if (letters && letters !== orderPrefix.toUpperCase()) return null;
  return Number(digits);
}

// Where a new order starts:
// - Counter drop-off: the clothes are already here, so Received by store.
// - Phone or WhatsApp drop-off: Booked, until the customer brings them in.
// - Staff-entered pickup & delivery: Pickup scheduled, because staff agree the
//   window and the charge with the customer directly.
// - Online bookings (Feature 13): Booked; staff then confirm the window.
export function getInitialStage(channel: OrderChannel, fulfilmentType: FulfilmentType): OrderStage {
  if (channel === "ONLINE") return "BOOKED";
  if (fulfilmentType === "PICKUP_DELIVERY") return "PICKUP_SCHEDULED";
  return channel === "COUNTER" ? "RECEIVED_BY_STORE" : "BOOKED";
}

// ───────────── Showing an order ─────────────

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PAYSTACK: "Paystack",
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  POS: "POS",
  OTHER: "Other",
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  DECLINED: "Declined",
  SUPERSEDED: "Superseded",
};

// A revision's label in the quote history. Version 1 of an order that wasn't
// fully priced at creation was never sent for approval (the priced quote is a
// later version), so it is an Estimate, not "Awaiting approval".
export interface RevisionStatus {
  version: number;
  status: QuoteStatus;
  approvedAt: Date | null;
  declinedAt: Date | null;
}

export function getQuoteRevisionLabel(revision: RevisionStatus): string {
  if (isEstimate(revision)) return "Estimate";
  return QUOTE_STATUS_LABELS[revision.status];
}

// A revision sent to the customer and not yet approved or declined. An
// estimate (version 1 never sent) isn't waiting for anyone.
export function isAwaitingApproval(revision: RevisionStatus): boolean {
  return revision.status === "PENDING" && !isEstimate(revision);
}

function isEstimate(revision: RevisionStatus): boolean {
  return revision.version === 1 && revision.approvedAt === null && revision.declinedAt === null;
}

// A timeline entry's label. A pickup order normally completes from Out for
// delivery, so completing one from Ready means the customer collected it.
export function getTimelineLabel(
  event: { fromStage: OrderStage | null; toStage: OrderStage },
  fulfilmentType: FulfilmentType,
): string {
  if (event.toStage === "COMPLETED" && event.fromStage === "READY" && fulfilmentType === "PICKUP_DELIVERY") {
    return "Completed: collected by customer";
  }
  return ORDER_STAGE_LABELS[event.toStage];
}

// Who did something in the timeline. A staff member's name when known.
export function getActorLabel(actorType: ActorType, staffName: string | null): string {
  switch (actorType) {
    case "STAFF":
      return staffName ?? "Staff";
    case "CUSTOMER":
      return "Customer";
    case "SYSTEM":
      return "System";
    case "FLUTA_ADMIN":
      return "Fluta admin";
  }
}

// "Customer's estimate: 2.5 kg (not billed)", "Customer's estimate: 2 (not
// billed)": what the customer entered on a line the store still weighs or
// counts. Staff screens only.
export function describeCustomerEstimate(estimate: number, pricingType: PricingType): string {
  return `Customer's estimate: ${formatQuantity(estimate, pricingType)} (not billed)`;
}

export interface SummaryLine {
  description: string;
  pricingType: PricingType | null;
  quantity: number | null; // hundredths; null until weighed
}

const SUMMARY_LINES_SHOWN = 2;

// "Shirt × 4, Trousers × 2 +2 more": the first service lines of an order,
// for the orders list. Weights show in kg; an unweighed line shows its name.
export function summarizeServices(lines: readonly SummaryLine[]): string {
  const shown = lines.slice(0, SUMMARY_LINES_SHOWN).map((line) => {
    if (line.quantity === null || line.pricingType === null) return line.description;
    const quantity = formatQuantity(line.quantity, line.pricingType);
    return line.pricingType === "PER_KG" ? `${line.description} ${quantity}` : `${line.description} × ${quantity}`;
  });
  const more = lines.length - shown.length;
  return more > 0 ? `${shown.join(", ")} +${more} more` : shown.join(", ");
}
