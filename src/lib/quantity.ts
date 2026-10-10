import type { PricingType } from "@/generated/prisma/enums";

// Order-line quantities: whole items or packages, or a weight in kg with up to
// two decimal places. Held as whole hundredths (3 items → 300, 2.5 kg → 250)
// so they are added and priced without decimal maths, and stored in the
// OrderLine Decimal columns as strings ("2.50").

export const MAX_ITEM_QUANTITY = 999;
export const MIN_WEIGHT_HUNDREDTHS = 10; // 0.1 kg
export const MAX_WEIGHT_HUNDREDTHS = 99_999; // 999.99 kg

const QUANTITY = /^(\d{1,6})(?:\.(\d{1,2}))?$/;

export function isWeighed(pricingType: PricingType): boolean {
  return pricingType === "PER_KG";
}

// Hundredths for a number with up to two decimal places ("3" → 300,
// "2.5" → 250), or null if the text isn't one. Whether it suits the service
// (whole items, a weight in range) is getQuantityProblem's job.
export function parseHundredths(text: string): number | null {
  const match = QUANTITY.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export type QuantityProblem = "INVALID" | "TOO_SMALL" | "TOO_LARGE";

// Null when the hundredths are a whole number of items 1–999, or a weight
// 0.1–999.99 kg.
export function getQuantityProblem(hundredths: number, pricingType: PricingType): QuantityProblem | null {
  if (!Number.isSafeInteger(hundredths)) return "INVALID";
  if (isWeighed(pricingType)) {
    if (hundredths < MIN_WEIGHT_HUNDREDTHS) return "TOO_SMALL";
    return hundredths > MAX_WEIGHT_HUNDREDTHS ? "TOO_LARGE" : null;
  }
  if (hundredths % 100 !== 0) return "INVALID";
  if (hundredths < 100) return "TOO_SMALL";
  return hundredths > MAX_ITEM_QUANTITY * 100 ? "TOO_LARGE" : null;
}

// "2.50" for the Decimal columns.
export function toDecimalString(hundredths: number): string {
  return `${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

// Hundredths from a stored Decimal ("2.500", "3"), rounded to two places.
export function fromDecimalString(text: string): number {
  const [whole, fraction = ""] = text.split(".");
  const thousandths = Number(whole) * 1000 + Number(fraction.slice(0, 3).padEnd(3, "0"));
  return Math.round(thousandths / 10);
}

// "5" items, "2.5 kg": the quantity as staff typed it, without trailing zeros.
export function formatQuantity(hundredths: number, pricingType: PricingType): string {
  const whole = Math.trunc(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, "0").replace(/0+$/, "");
  const number = fraction ? `${whole}.${fraction}` : String(whole);
  return isWeighed(pricingType) ? `${number} kg` : number;
}
