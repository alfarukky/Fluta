import { z } from "zod";

import { PaymentMethod, PaymentSource } from "@/generated/prisma/enums";
import { formatNaira, parseNairaToKobo } from "@/lib/money";
import { MAX_PAYMENT_AMOUNT, STORE_PAYMENT_METHODS } from "@/lib/payments";

export const PAYMENT_REFERENCE_MAX = 100;
export const PAYMENT_NOTE_MAX = 200;
export const VOID_REASON_MAX = 200;

export const PAYMENT_FORM_EXPIRED_MESSAGE = "This form has expired. Close it and try again.";

export const recordId = z.string().trim().min(1).max(64);

const AMOUNT_FORMAT_MESSAGE = "Enter an amount in Naira, like 5,000 or 5,000.50";

// The amount as staff typed it, in kobo: above ₦0 and at most ₦10,000,000.
// `emptyMessage` is shown when nothing was entered.
export function nairaAmountSchema(emptyMessage: string) {
  return z
    .string(AMOUNT_FORMAT_MESSAGE)
    .max(40, AMOUNT_FORMAT_MESSAGE)
    .transform((value, ctx) => {
      if (!value.trim()) {
        ctx.addIssue({ code: "custom", message: emptyMessage });
        return z.NEVER;
      }
      const kobo = parseNairaToKobo(value);
      if (kobo === null) {
        ctx.addIssue({ code: "custom", message: AMOUNT_FORMAT_MESSAGE });
        return z.NEVER;
      }
      if (kobo === 0) {
        ctx.addIssue({ code: "custom", message: "Enter an amount above ₦0" });
        return z.NEVER;
      }
      if (kobo > MAX_PAYMENT_AMOUNT) {
        ctx.addIssue({ code: "custom", message: `Amount must be ${formatNaira(MAX_PAYMENT_AMOUNT)} or less` });
        return z.NEVER;
      }
      return kobo;
    });
}

export const paymentAmountSchema = nairaAmountSchema("Enter the amount paid");

// Trimmed, and stored as NULL when blank.
export function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .nullish()
    .transform((value) => value || null);
}

// The amount staff confirmed going over the balance due, from the warning
// they saw (null when they saw none).
const confirmedExcessSchema = z.number().int().min(0).max(MAX_PAYMENT_AMOUNT).nullable().default(null);

// A store-collected payment's details: the record form, and the correct
// payment recorded when voiding a mistaken one.
const paymentDetailsShape = {
  amount: paymentAmountSchema,
  method: z.enum(STORE_PAYMENT_METHODS, "Choose how the customer paid"),
  reference: optionalText(PAYMENT_REFERENCE_MAX, "Reference"),
  note: optionalText(PAYMENT_NOTE_MAX, "Note"),
};

// The details on their own, for the forms' checks before sending.
export const paymentDetailsSchema = z.object(paymentDetailsShape);

export const recordPaymentSchema = z.object({
  orderId: recordId,
  // Generated once when the form opens (crypto.randomUUID()); sending the
  // same request again returns the payment it already recorded.
  clientRequestId: z.uuid(PAYMENT_FORM_EXPIRED_MESSAGE),
  confirmedExcess: confirmedExcessSchema,
  ...paymentDetailsShape,
});

export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;
export type RecordPaymentRequest = z.input<typeof recordPaymentSchema>;

const voidReasonSchema = z
  .string("Add a reason for voiding this payment")
  .trim()
  .min(1, "Add a reason for voiding this payment")
  .max(VOID_REASON_MAX, `Reason must be ${VOID_REASON_MAX} characters or fewer`);

// Voiding a payment (owners only): void only, or void and record the correct
// payment in its place.
export const voidPaymentSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("VOID_ONLY"),
    paymentId: recordId,
    reason: voidReasonSchema,
  }),
  z.object({
    mode: z.literal("REPLACE"),
    paymentId: recordId,
    reason: voidReasonSchema,
    // The replacement's request ID: a retry returns the same replacement.
    clientRequestId: z.uuid(PAYMENT_FORM_EXPIRED_MESSAGE),
    confirmedExcess: confirmedExcessSchema,
    ...paymentDetailsShape,
  }),
]);

export type VoidPaymentInput = z.output<typeof voidPaymentSchema>;
export type VoidPaymentRequest = z.input<typeof voidPaymentSchema>;

// ───────────── Payments page ─────────────

export const PAYMENT_DATE_RANGES = ["today", "7d", "30d"] as const;
export type PaymentDateRange = (typeof PAYMENT_DATE_RANGES)[number];

export const PAYMENT_DATE_RANGE_LABELS: Record<PaymentDateRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

// The owner totals' heading. Totals follow the date filter only, so the
// heading says so, and they aren't read as totals of a filtered list.
export const PAYMENT_TOTALS_LABELS: Record<PaymentDateRange, string> = {
  today: "Totals for today, all methods and sources",
  "7d": "Totals for the last 7 days, all methods and sources",
  "30d": "Totals for the last 30 days, all methods and sources",
};

// The page's filters, from its address. Anything missing or invalid falls
// back to its default rather than failing the page.
// Payments received, or refunds paid back (Feature 18). The Refunds view
// uses only the date filter.
export const PAYMENT_PAGE_VIEWS = ["payments", "refunds"] as const;
export type PaymentPageView = (typeof PAYMENT_PAGE_VIEWS)[number];

export const paymentListFiltersSchema = z.object({
  view: z.enum(PAYMENT_PAGE_VIEWS).catch("payments"),
  date: z.enum(PAYMENT_DATE_RANGES).catch("today"),
  method: z.enum(PaymentMethod).nullable().catch(null),
  source: z.enum(PaymentSource).nullable().catch(null),
});

export type PaymentListFilters = z.output<typeof paymentListFiltersSchema>;

export const DEFAULT_PAYMENT_LIST_FILTERS: PaymentListFilters = paymentListFiltersSchema.parse({});

// Where "Load more" continues from: the last row's confirmation time and ID.
export const paymentListCursorSchema = z
  .string()
  .regex(/^\d{1,15}\.[A-Za-z0-9_-]{1,64}$/)
  .transform((text) => {
    const dot = text.indexOf(".");
    return { confirmedAt: new Date(Number(text.slice(0, dot))), id: text.slice(dot + 1) };
  });

export function encodePaymentListCursor(cursor: { confirmedAt: Date; id: string }): string {
  return `${cursor.confirmedAt.getTime()}.${cursor.id}`;
}

// The page address for a set of filters, leaving out defaults ("" for none).
export function toPaymentListSearch(filters: PaymentListFilters): string {
  const params = new URLSearchParams();
  if (filters.view !== DEFAULT_PAYMENT_LIST_FILTERS.view) params.set("view", filters.view);
  if (filters.date !== DEFAULT_PAYMENT_LIST_FILTERS.date) params.set("date", filters.date);
  if (filters.method) params.set("method", filters.method);
  if (filters.source) params.set("source", filters.source);
  const search = params.toString();
  return search ? `?${search}` : "";
}
