import type { FulfilmentType, OrderChannel, OrderStage } from "@/generated/prisma/enums";

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

// "FF-1024". The one way an order number is shown; never build it by hand.
// The prefix is display-only, so changing it never changes stored numbers.
export function formatOrderNumber(store: { orderPrefix: string }, orderNumber: number): string {
  return `${store.orderPrefix}-${orderNumber}`;
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
