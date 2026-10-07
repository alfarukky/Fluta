import type { PricingType } from "@/generated/prisma/enums";

// A catalogue service as the services page shows it (price in kobo).
// updatedAt tells the page which of two copies of a service is newer.
export interface CatalogueService {
  id: string;
  name: string;
  category: string | null;
  pricingType: PricingType;
  price: number;
  requiresQuote: boolean;
  isActive: boolean;
  updatedAt: Date;
}
