import type { Coordinates } from "@/lib/location";

// What the Deliveries view shows about an order, and nothing more: no prices,
// totals, payments, revisions, notes, or history (riders use this view).

// A delivery card (On the way, Ready to deliver). No time: the MVP promises
// no delivery time.
export interface DeliveryCard {
  orderId: string;
  orderNumber: string; // formatted, "FF-1042"
  customerName: string;
  customerPhone: string; // E.164, for the Call link
  address: string | null;
  areaName: string | null; // the order's copy of the area name
  isOutOfArea: boolean;
  // The customer's shared location, for "Open in Maps" only.
  location: Coordinates | null;
  stage: "PICKUP_SCHEDULED" | "READY" | "OUT_FOR_DELIVERY";
}

// A pickup card: also the scheduled date ("YYYY-MM-DD") and window (stored
// 24-hour times), and whether it is overdue (scheduled before today).
export interface PickupCard extends DeliveryCard {
  stage: "PICKUP_SCHEDULED";
  scheduledDate: string;
  windowStart: string | null;
  windowEnd: string | null;
  isOutsideSchedule: boolean;
  isOverdue: boolean;
}

export interface DeliverySections {
  pickups: PickupCard[];
  onTheWay: DeliveryCard[];
  readyToDeliver: DeliveryCard[];
}

// The three moves the Deliveries view offers, one per button.
export type DeliveryMove = "PICK_UP" | "SEND_OUT" | "DELIVER";
