import type { AreaChargeType, FulfilmentType, OrderStage, PricingType } from "@/generated/prisma/enums";
import type { PaymentState } from "@/lib/orders";

// A customer as the new-order form shows them; the phone number is formatted
// for display ("+234 803 123 4521"), in full because only the store's own
// owner and staff see it.
export interface CustomerMatch {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

// An active service staff can add to an order (price in kobo).
export interface OrderEntryService {
  id: string;
  name: string;
  category: string | null;
  pricingType: PricingType;
  price: number;
  requiresQuote: boolean;
}

// An active service area for a pickup order.
export interface OrderEntryArea {
  id: string;
  name: string;
  chargeType: AreaChargeType;
  fixedCharge: number | null;
}

// One row of the orders list, ready to show. It is sent to the browser for
// "Load more", so it holds display text only.
export interface OrderListRow {
  id: string;
  displayNumber: string;
  customerName: string;
  services: string;
  total: string | null; // null = no approved quote (Awaiting quote, or Not priced if cancelled)
  paymentState: PaymentState;
  stage: OrderStage;
  fulfilmentType: FulfilmentType;
  created: string;
  pickup: string | null; // pickup orders only
}

export interface OrderListPage {
  rows: OrderListRow[];
  // Pass back to load the next page; null when this is the last.
  nextCursor: string | null;
}

// A list query, already worked out from the page's search and filters (see
// src/server/domain/order-list.ts). Every part is optional.
export interface OrderListQuery {
  search: { orderNumber: number | null; phoneDigits: string | null; name: string } | null;
  stage: OrderStage | null;
  paymentState: PaymentState | null;
  fulfilmentType: FulfilmentType | null;
  createdFrom: Date | null;
  // The last row already shown: newest first, so the next page is older.
  after: OrderListCursor | null;
}

export interface OrderListCursor {
  createdAt: Date;
  id: string;
}

// ───────────── Order stages ─────────────

// The moves the order detail page offers (see getAvailableTransitions in
// src/server/domain/order-stages.ts). Moves into or out of Quote awaiting
// approval (other than cancelling) and Booked → Pickup scheduled come with
// quotes and online bookings.
export type StageMoveKind = "ADVANCE" | "COLLECTED_INSTEAD" | "STEP_BACK" | "CANCEL" | "REOPEN";

export interface StageMove {
  kind: StageMoveKind;
  to: OrderStage;
  collectedByCustomer: boolean;
  noteRequired: boolean;
}

export interface AvailableTransitions {
  // The main next move, when it is allowed.
  primary: StageMove | null;
  // Every other allowed move, in menu order.
  secondary: StageMove[];
  // Why the main next move isn't allowed yet, in plain language.
  blockedReason: string | null;
}

// ───────────── Quotes ─────────────

// A service line already on the order, for the edit-quote screen. It keeps
// the unit price it was added at.
export interface QuoteEditorLine {
  id: string;
  name: string;
  pricingType: PricingType;
  requiresQuote: boolean;
  unitPrice: number;
  quantity: number | null; // hundredths; null while unweighed
  estimate: number | null; // hundredths, the customer's estimate
}

// Everything the edit-quote screen needs, from the order's own copies.
export interface QuoteEditorData {
  orderId: string;
  displayNumber: string;
  stage: OrderStage;
  fulfilmentType: FulfilmentType;
  // The newest version: the screen sends it back, and nothing is saved if
  // another revision was issued in the meantime.
  latestVersion: number;
  lines: QuoteEditorLine[];
  adjustments: { description: string; amount: number }[];
  pickup: {
    areaName: string | null;
    isOutOfArea: boolean;
    // Staff enter the charge when keeping the area (quote-required or out of area).
    chargeEntered: boolean;
    charge: number | null;
  } | null;
  approvedTotal: number | null;
  hasPendingRevision: boolean;
  reasonRequired: boolean;
}
