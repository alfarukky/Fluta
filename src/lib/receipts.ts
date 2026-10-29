import type { PaymentMethod, PaymentStatus } from "@/generated/prisma/enums";

import { formatNaira } from "./money";
import type { PaymentState } from "./orders";
import { resolveTimeZone } from "./time";

// Receipts are read by customers, so every word on one is plain everyday
// English: never "revision", "adjustment", "Others", a state, or a code.
// The exact wording lives only here.

export const RECEIPT_TEXT = {
  noPayment: "A receipt will be available once a payment is recorded",
  items: "Items",
  pickupCharge: "Pickup and delivery",
  free: "Free",
  total: "Total",
  payments: "Payments",
  cancelled: "This order was cancelled",
  pendingPriceUpdate: "The store has proposed a new price you haven't approved yet. This receipt shows the price you agreed.",
  priceToBeConfirmed: "Final price to be confirmed by the store",
  fullyPaid: "Fully paid",
  nothingToPay: "Nothing to pay",
} as const;

export const receiptOrderNumber = (number: string) => `Order number: ${number}`;
export const receiptDate = (date: string) => `Date: ${date}`;
export const receiptCustomer = (name: string) => `Customer: ${name}`;
export const receiptPhone = (maskedPhone: string) => `Phone: ${maskedPhone}`;

const PAID_LABELS: Record<PaymentMethod, string> = {
  CASH: "Paid in cash",
  BANK_TRANSFER: "Paid by bank transfer",
  POS: "Paid by card (POS)",
  PAYSTACK: "Paid online",
  OTHER: "Paid (other)",
};

// Refunds are never online (Refund_method_check), so PAYSTACK can't occur.
const REFUNDED_LABELS: Record<Exclude<PaymentMethod, "PAYSTACK">, string> = {
  CASH: "Refunded in cash",
  BANK_TRANSFER: "Refunded by bank transfer",
  POS: "Refunded by card (POS)",
  OTHER: "Refunded (other)",
};

export function describeReceiptPayment(method: PaymentMethod, date: string): string {
  return `${PAID_LABELS[method]}, ${date}`;
}

export function describeReceiptRefund(method: PaymentMethod, date: string): string {
  return `${method === "PAYSTACK" ? REFUNDED_LABELS.OTHER : REFUNDED_LABELS[method]}, ${date}`;
}

// Amounts use the shared formatNaira ("₦10,000", "₦1,500.50": kobo only when
// there is some), always from the stored amounts, so the rows add up exactly.
// An extra charge or discount shows its stored sign: "+₦2,000", "−₦500".
export function formatSignedReceiptAmount(kobo: number): string {
  return kobo > 0 ? `+${formatNaira(kobo)}` : formatNaira(kobo);
}

// The balance line, from getBalance. Null while no price is approved (a
// deposit before approval shows no balance figure).
export function describeReceiptBalance(balance: { state: PaymentState; balanceKobo: number | null }): string | null {
  if (balance.balanceKobo === null) return null;
  switch (balance.state) {
    case "PAID":
      return RECEIPT_TEXT.fullyPaid;
    case "NOTHING_DUE":
      return RECEIPT_TEXT.nothingToPay;
    case "REFUND_OWED":
      return `Amount to be refunded to you: ${formatNaira(-balance.balanceKobo)}`;
    case "OUTSTANDING":
    case "PAYMENT_REQUIRED":
    case "PENDING":
      return `Amount still to pay: ${formatNaira(balance.balanceKobo)}`;
    case "AWAITING_QUOTE":
      return null;
  }
}

// A receipt exists only once the order has an active confirmed payment:
// confirmed and not voided. Pending or failed online attempts never count,
// and refunds alone never do.
export function hasActiveConfirmedPayment(payments: readonly { status: PaymentStatus; voidedAt: Date | null }[]): boolean {
  return payments.some((payment) => payment.status === "CONFIRMED" && payment.voidedAt === null);
}

const DAY_MONTH = { day: "numeric", month: "short" } as const;

// "30 Oct 2026, 10:42 AM" in the store's time zone.
export function formatReceiptDateTime(date: Date, timeZone: string): string {
  const parts = partsOf(date, timeZone, {
    ...DAY_MONTH,
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`;
}

// "30 Oct 2026" in the store's time zone, for a payment or refund.
export function formatReceiptDate(date: Date, timeZone: string): string {
  const parts = partsOf(date, timeZone, { ...DAY_MONTH, year: "numeric" });
  return `${parts.day} ${parts.month} ${parts.year}`;
}

// Built from parts so Node.js and browsers agree.
function partsOf(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  return new Intl.DateTimeFormat("en-GB", {
    ...options,
    timeZone: resolveTimeZone(timeZone),
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((parts, part) => ({ ...parts, [part.type]: part.value }), {});
}
