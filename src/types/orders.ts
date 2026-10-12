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
