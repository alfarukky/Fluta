import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type { CountryCode };

// Phone numbers are stored in E.164 ("+2348031234521"). Parsing, formatting,
// and masking all live here. The default country is always passed in by the
// caller: it decides how a number without a country code ("0803…") is read.

// E.164 for a valid number, or null. International numbers (with "+") are
// accepted whatever the default country.
export function normalizePhone(input: string, defaultCountry: CountryCode): string | null {
  const phone = parsePhoneNumberFromString(input.trim(), defaultCountry);
  return phone?.isValid() ? phone.number : null;
}

// "+2348031234521" → "+234 803 123 4521", for showing a stored number in full
// (to the store's own owner and staff only). Unparseable values are returned
// unchanged.
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

// "+2348031234521" → "+234 803 *** 4521": the country code, the first three
// and last four digits of the national number. Safe for logs, receipts, and
// anyone outside the store.
export function maskPhone(e164: string): string {
  const phone = parsePhoneNumberFromString(e164);
  if (!phone) return "***";
  const national = String(phone.nationalNumber);
  if (national.length < 8) return `+${phone.countryCallingCode} ***`;
  return `+${phone.countryCallingCode} ${national.slice(0, 3)} *** ${national.slice(-4)}`;
}

// Search text → the digits to look for anywhere in stored E.164 numbers, or
// null when it has none. Digits only, and a leading 0 (local Nigerian format,
// "0803…") becomes 234, so "0803 123", "803123", and "+234 803 123" all find
// +2348031234567.
export function toPhoneSearchDigits(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("0") ? `234${digits.slice(1)}` : digits;
}

// Automatic SMS go only to Nigerian numbers (+234). Others get their link on
// the booking confirmation, by email, or by WhatsApp from staff.
export function isNigerianNumber(e164: string): boolean {
  return /^\+234\d+$/.test(e164);
}
