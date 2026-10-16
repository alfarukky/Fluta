import type { CustomerTimelineState } from "@/lib/tracking";

import type { PublicStore } from "./booking";

// What the tracking page (/o/{token}) shows, built on the server in plain
// words. Every amount and date is already formatted, and nothing here is
// ever an address, a full phone number, a note, or a staff name.

export interface TrackingTimelineStep {
  key: string;
  label: string;
  state: CustomerTimelineState;
  // When the order reached the step, in the store's time zone (12-hour).
  at: string | null;
}

export interface TrackingItem {
  key: string;
  name: string;
  // "2 × ₦800", "2.5 kg × ₦1,500", "About 3 kg. The store will weigh it."
  detail: string | null;
  // Only from an approved price (or the price update under review).
  amount: string | null;
}

export type TrackingPrice =
  // The approved price: its items, pickup & delivery charge, and total.
  | { kind: "approved"; items: TrackingItem[]; charge: string | null; total: string }
  // Nothing approved yet, but every part can be estimated.
  | { kind: "estimate"; items: TrackingItem[]; total: string }
  // Nothing approved yet: "The store will confirm the price".
  | { kind: "unknown"; items: TrackingItem[] };

export interface TrackingPickup {
  area: string | null;
  date: string;
  time: string | null;
  status: "Requested" | "Suggested by the store" | "Confirmed";
}

export interface PriceUpdateReview {
  revisionId: string;
  previousTotal: string | null;
  newTotal: string;
  // "+₦2,500", "−₦500", "No change"; null when nothing was approved before.
  difference: string | null;
  direction: "up" | "down" | "same" | null;
  reason: string | null;
  items: TrackingItem[];
  // Pickup & delivery; null for a drop-off order.
  charge: string | null;
}

export interface PickupSuggestionReview {
  suggestionId: string;
  date: string;
  time: string;
  // What the customer asked for when booking ("Tue, 20 Oct 2026 · 10:00 AM–12:00 PM").
  requested: string | null;
}

export interface TrackingView {
  store: PublicStore;
  displayNumber: string;
  stageLabel: string;
  // Completed or cancelled: view only.
  closed: boolean;
  timeline: TrackingTimelineStep[];
  payment: string;
  price: TrackingPrice;
  pickup: TrackingPickup | null;
  maskedPhone: string;
  // What is waiting for the customer (at most one card shows): a price
  // update first, since a pickup time can't be confirmed until it's decided.
  priceUpdate: PriceUpdateReview | null;
  pickupSuggestion: PickupSuggestionReview | null;
}

export type TrackingPage =
  | { kind: "NOT_FOUND" }
  // The store is Deactivated: nothing about it is shown.
  | { kind: "UNAVAILABLE" }
  | { kind: "EXPIRED"; storeName: string; storePhone: string | null; storePhoneHref: string | null }
  | { kind: "VALID"; view: TrackingView };
