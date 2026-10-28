import type { PaymentMethod } from "@/generated/prisma/enums";

// One row of the Payments page's Refunds view, ready to show. It is sent to
// the browser for "Load more", so it holds display text only, and never a
// note, reference, or void reason.
export interface RefundListRow {
  id: string;
  orderId: string;
  displayNumber: string;
  customerName: string;
  paid: string; // "Tue, 20 Oct 2026, 2:15 PM" in the store's time zone
  amount: string;
  method: PaymentMethod;
  recordedBy: string;
  voided: boolean;
  // Recorded in place of a voided refund.
  correction: boolean;
}

export interface RefundListPage {
  rows: RefundListRow[];
  // Pass back to load the next page; null when this is the last.
  nextCursor: string | null;
}
