import type { FulfilmentType } from "@/generated/prisma/enums";

// Order pricing rules shared by the new-order form (its live review) and the
// server, which always recomputes them from the catalogue and area. Amounts
// are integer kobo; quantities are hundredths (src/lib/quantity.ts). Line
// totals come from lineTotalKobo in money.ts.

export interface ServiceLineQuantities {
  serviceId: string;
  // Null on a quote-required line that hasn't been weighed yet.
  quantity: number | null;
  // The customer's estimate, never billed.
  estimate: number | null;
}

// One line per service, in the order each service first appears. "Shirt × 2"
// and "Shirt × 3" become "Shirt × 5". A line still waiting to be weighed keeps
// the merged line unweighed (staff weigh everything together later), and
// estimates add up.
export function mergeServiceLines<T extends ServiceLineQuantities>(lines: readonly T[]): T[] {
  const merged = new Map<string, T>();
  for (const line of lines) {
    const existing = merged.get(line.serviceId);
    if (!existing) {
      merged.set(line.serviceId, { ...line });
      continue;
    }
    merged.set(line.serviceId, {
      ...existing,
      quantity: existing.quantity === null || line.quantity === null ? null : existing.quantity + line.quantity,
      estimate: existing.estimate === null && line.estimate === null ? null : (existing.estimate ?? 0) + (line.estimate ?? 0),
    });
  }
  return [...merged.values()];
}

export interface OrderAmounts {
  // Service line totals; null for a line that isn't priced yet (unweighed).
  serviceLineTotals: readonly (number | null)[];
  // Signed "Others" amounts: positive extra charges, negative discounts.
  adjustments: readonly number[];
  // Null when there is none yet (quote pending) or it doesn't apply (drop-off).
  fulfilmentCharge: number | null;
}

// Service lines + adjustments + fulfilment charge, counting only what is
// priced so far. An order may not be created with a negative total.
export function getOrderTotal({ serviceLineTotals, adjustments, fulfilmentCharge }: OrderAmounts): number {
  const lines = serviceLineTotals.reduce<number>((sum, total) => sum + (total ?? 0), 0);
  const others = adjustments.reduce((sum, amount) => sum + amount, 0);
  return lines + others + (fulfilmentCharge ?? 0);
}

export interface PricingState {
  fulfilmentType: FulfilmentType;
  lines: readonly { requiresQuote: boolean; quantity: unknown }[];
  // Null on a pickup order while its quote-required charge is still pending.
  fulfilmentCharge: number | null;
}

// Fully priced: every quote-required line has its quantity (weighed or
// counted), and a pickup order's charge is known. A fully priced order's
// version 1 can be agreed at once; otherwise the priced quote comes later.
export function isOrderFullyPriced({ fulfilmentType, lines, fulfilmentCharge }: PricingState): boolean {
  const linesPriced = lines.every((line) => !line.requiresQuote || (line.quantity !== null && line.quantity !== undefined));
  const chargeKnown = fulfilmentType !== "PICKUP_DELIVERY" || fulfilmentCharge !== null;
  return linesPriced && chargeKnown;
}
