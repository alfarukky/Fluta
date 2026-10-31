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

// "Coming up": the next 7 days, for planning only. Plain text lines, with no
// IDs, customers, addresses, order numbers, links, or money.
export interface ComingUpDay {
  date: string; // "YYYY-MM-DD"
  heading: string; // "Tomorrow, Fri 31 Oct · 3 pickups"
  pickups: string[]; // "10:00 AM – 12:00 PM · Wuse", by window start
}

export interface ComingUp {
  days: ComingUpDay[];
  waiting: string | null; // "2 more pickups are waiting for the store to confirm a time."
  cleaning: string | null; // "4 orders are being cleaned and will need delivery."
  empty: boolean; // nothing at all to say: "Nothing coming up in the next 7 days"
}
