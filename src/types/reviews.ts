// Customer reviews (Feature 19b), ready to show. Private to the store: these
// only ever go to owners and staff, apart from the customer's own thank-you
// card (its stars only).

// One review on the Reviews page. Sent to the browser for "Load more", so it
// holds display text only, never the customer's phone or address.
export interface ReviewListRow {
  id: string;
  orderId: string;
  displayNumber: string; // "FF-1024"
  customerName: string; // the customer's current name
  rating: number;
  comment: string | null; // plain text, shown escaped
  date: string; // "Tue, 20 Oct 2026, 2:15 PM" in the store's time zone
}

export interface ReviewListPage {
  rows: ReviewListRow[];
  // Pass back to load the next page; null when this is the last.
  nextCursor: string | null;
}

export interface ReviewSummary {
  count: number;
  // "4.3", or null when there are no reviews.
  average: string | null;
}

// The customer's review card on their order page: the form while they can
// still review, or the thank-you card once they have.
export type TrackingReview = { kind: "form"; storeName: string } | { kind: "thanks"; rating: number };
