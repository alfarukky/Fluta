import type { AreaChargeType } from "@/generated/prisma/enums";

// A service area as the fulfilment page shows it (charge in kobo).
// updatedAt tells the page which of two copies of an area is newer.
export interface FulfilmentArea {
  id: string;
  name: string;
  chargeType: AreaChargeType;
  fixedCharge: number | null;
  isActive: boolean;
  updatedAt: Date;
}

// A day the store doesn't do pickups or deliveries; date is "YYYY-MM-DD".
export interface FulfilmentClosedDate {
  id: string;
  date: string;
  note: string | null;
}
