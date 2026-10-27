// Order-line quantities: a whole number of items or packages, 1 to 999, for
// every pricing type. Stored in the OrderLine Decimal columns as text ("3"),
// where a database CHECK also keeps them whole.

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 999;

const WHOLE_NUMBER = /^\d{1,6}$/;

// The whole number in the text ("3" → 3), or null if it isn't one ("1.5",
// "2 pcs", "-1"). Whether it is in range is getQuantityProblem's job.
export function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : null;
}

export type QuantityProblem = "INVALID" | "TOO_SMALL" | "TOO_LARGE";

// Null when the quantity is a whole number from 1 to 999.
export function getQuantityProblem(quantity: number): QuantityProblem | null {
  if (!Number.isSafeInteger(quantity)) return "INVALID";
  if (quantity < MIN_QUANTITY) return "TOO_SMALL";
  return quantity > MAX_QUANTITY ? "TOO_LARGE" : null;
}

// "3" for the Decimal columns.
export function toStoredQuantity(quantity: number): string {
  if (getQuantityProblem(quantity)) throw new RangeError("Quantities are whole numbers from 1 to 999.");
  return String(quantity);
}

// The whole number from a stored Decimal ("3", "3.000") or an older quote
// snapshot written with decimal places ("3.00").
export function fromStoredQuantity(text: string): number {
  const quantity = Number(text);
  if (!Number.isSafeInteger(quantity)) throw new RangeError(`Stored quantity "${text}" isn't a whole number.`);
  return quantity;
}

const QUANTITY_MESSAGES: Record<QuantityProblem | "REQUIRED", string> = {
  REQUIRED: "Enter how many",
  INVALID: "Enter a whole number",
  TOO_SMALL: `Enter at least ${MIN_QUANTITY}`,
  TOO_LARGE: `Enter ${MAX_QUANTITY} or fewer`,
};

// Why a line's quantity can't be used, in the form's words, or null if it
// can. Blank (null) counts as missing.
export function getQuantityMessage(quantity: number | null): string | null {
  if (quantity === null) return QUANTITY_MESSAGES.REQUIRED;
  const problem = getQuantityProblem(quantity);
  return problem ? QUANTITY_MESSAGES[problem] : null;
}
