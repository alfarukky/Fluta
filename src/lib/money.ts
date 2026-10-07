import type { AreaChargeType, PricingType } from "@/generated/prisma/enums";

// Money is always an integer number of kobo (₦1 = 100 kobo). Formatting and
// parsing live only here.

// "₦6,200", "₦1,500.50"; kobo shown only when non-zero. Negative amounts
// (discounts, refunds) get a leading minus sign: "−₦500".
export function formatNaira(kobo: number): string {
  const sign = kobo < 0 ? "−" : "";
  return `${sign}₦${formatAmount(Math.abs(kobo))}`;
}

// The amount without the ₦ sign, as the owner would type it back into a price
// field: "1,500", "1,500.50".
export function formatNairaInput(kobo: number): string {
  return formatAmount(Math.abs(kobo));
}

function formatAmount(kobo: number): string {
  const naira = Math.trunc(kobo / 100);
  const rest = kobo % 100;
  const grouped = String(naira).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest === 0 ? grouped : `${grouped}.${String(rest).padStart(2, "0")}`;
}

// Whole naira, with commas only as thousands separators ("1,500", never
// "15,00"), then up to two decimal places.
const NAIRA_INPUT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

// Integer kobo from an owner's input, or null if it isn't a plain non-negative
// Naira amount. A leading ₦ and surrounding spaces are ignored. Done on the
// string, never through floats, so "1500.10" is exactly 150,010 kobo.
export function parseNairaToKobo(input: string): number | null {
  const text = input.trim().replace(/^₦\s*/, "");
  const match = NAIRA_INPUT.exec(text);
  if (!match) return null;

  const naira = match[1].replaceAll(",", "");
  const kobo = Number(naira) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(kobo) ? kobo : null;
}

const PRICING_UNITS: Record<PricingType, string> = {
  PER_ITEM: "item",
  PER_KG: "kg",
  PER_PACKAGE: "package",
};

export interface PricedService {
  price: number;
  pricingType: PricingType;
  requiresQuote: boolean;
}

// "₦800 / item"; for a quote-required service the price is a starting price,
// "from ₦5,000 / item", or "Price on inspection" when that is ₦0.
export function formatServicePrice({ price, pricingType, requiresQuote }: PricedService): string {
  const perUnit = `${formatNaira(price)} / ${PRICING_UNITS[pricingType]}`;
  if (!requiresQuote) return perUnit;
  return price === 0 ? "Price on inspection" : `from ${perUnit}`;
}

export interface AreaCharge {
  chargeType: AreaChargeType;
  fixedCharge: number | null;
}

// A service area's pickup/delivery charge (one per order, covering pickup and
// return delivery): "₦1,500", "Free" for ₦0, or "Quote required".
export function formatAreaCharge({ chargeType, fixedCharge }: AreaCharge): string {
  if (chargeType === "QUOTE_REQUIRED" || fixedCharge === null) return "Quote required";
  return fixedCharge === 0 ? "Free" : formatNaira(fixedCharge);
}
