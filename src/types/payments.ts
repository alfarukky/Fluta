import type { PaymentMethod, PaymentSource } from "@/generated/prisma/enums";

// One row of the Payments page, ready to show. It is sent to the browser for
// "Load more", so it holds display text only.
export interface PaymentListRow {
  id: string;
  orderId: string;
  displayNumber: string;
  customerName: string;
  confirmed: string; // "Tue, 20 Oct 2026, 2:15 PM" in the store's time zone
  amount: string;
  method: PaymentMethod;
  source: PaymentSource;
  // A staff name, or "Online payment" for online payments.
  recordedBy: string;
  voided: boolean;
}

export interface PaymentListPage {
  rows: PaymentListRow[];
  // Pass back to load the next page; null when this is the last.
  nextCursor: string | null;
}

// Owners only: confirmed payments in the chosen period. Voided ones count ₦0.
export interface PaymentTotals {
  storeCollectedKobo: number;
  onlineKobo: number;
}

// A list query, already worked out from the page's filters (see
// src/server/domain/payments.ts).
export interface PaymentListQuery {
  confirmedFrom: Date;
  method: PaymentMethod | null;
  source: PaymentSource | null;
  // The last row already shown: newest first, so the next page is older.
  after: PaymentListCursor | null;
}

export interface PaymentListCursor {
  confirmedAt: Date;
  id: string;
}
