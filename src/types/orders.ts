import type { AreaChargeType, PricingType } from "@/generated/prisma/enums";

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
