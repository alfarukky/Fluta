// What a receipt shows, already worded and formatted. Nothing else about the
// order ever reaches the page: no references, notes, staff names, fees, the
// full phone, or an address of the customer's.

export interface ReceiptStore {
  name: string;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
}

// A row with an amount on the right ("Duvet  2 × ₦5,000  ₦10,000"). Before a
// price is approved, rows show names and quantities only (amount null).
export interface ReceiptRow {
  key: string;
  label: string;
  detail: string | null;
  amount: string | null;
}

export interface Receipt {
  store: ReceiptStore;
  // "This order was cancelled", shown at the top.
  cancelledNote: string | null;
  orderNumber: string;
  date: string;
  customer: string;
  phone: string;
  lines: ReceiptRow[];
  // Null when no price is approved yet.
  total: ReceiptRow | null;
  // The pending price update note, or "Final price to be confirmed by the store".
  priceNote: string | null;
  payments: ReceiptRow[];
  // Null when no price is approved yet (and the order isn't cancelled).
  balance: string | null;
}
