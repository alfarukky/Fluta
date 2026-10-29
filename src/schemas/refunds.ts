import { z } from "zod";

import { REFUND_METHODS } from "@/lib/refunds";

import {
  nairaAmountSchema,
  optionalText,
  PAYMENT_FORM_EXPIRED_MESSAGE,
  PAYMENT_NOTE_MAX,
  PAYMENT_REFERENCE_MAX,
  recordId,
  VOID_REASON_MAX,
  type PaymentDateRange,
} from "./payments";

export const REFUND_REFERENCE_MAX = PAYMENT_REFERENCE_MAX;
export const REFUND_NOTE_MAX = PAYMENT_NOTE_MAX;
export const REFUND_VOID_REASON_MAX = VOID_REASON_MAX;

// A refund's details: the record form, and the correct refund recorded when
// voiding a mistaken one. Amounts are limited by what is owed on the server.
const refundDetailsShape = {
  amount: nairaAmountSchema("Enter the amount refunded"),
  method: z.enum(REFUND_METHODS, "Choose how it was paid back"),
  reference: optionalText(REFUND_REFERENCE_MAX, "Reference"),
  note: z
    .string("Add a note about this refund")
    .trim()
    .min(1, "Add a note about this refund")
    .max(REFUND_NOTE_MAX, `Note must be ${REFUND_NOTE_MAX} characters or fewer`),
};

// The details on their own, for the forms' checks before sending.
export const refundDetailsSchema = z.object(refundDetailsShape);

export const recordRefundSchema = z.object({
  orderId: recordId,
  // Generated once when the form opens (crypto.randomUUID()); sending the
  // same request again returns the refund it already recorded.
  clientRequestId: z.uuid(PAYMENT_FORM_EXPIRED_MESSAGE),
  ...refundDetailsShape,
});

export type RecordRefundInput = z.output<typeof recordRefundSchema>;
export type RecordRefundRequest = z.input<typeof recordRefundSchema>;

const voidReasonSchema = z
  .string("Add a reason for voiding this refund")
  .trim()
  .min(1, "Add a reason for voiding this refund")
  .max(REFUND_VOID_REASON_MAX, `Reason must be ${REFUND_VOID_REASON_MAX} characters or fewer`);

// Voiding a refund (owners only): void only, or void and record the correct
// refund in its place.
export const voidRefundSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("VOID_ONLY"),
    refundId: recordId,
    reason: voidReasonSchema,
  }),
  z.object({
    mode: z.literal("REPLACE"),
    refundId: recordId,
    reason: voidReasonSchema,
    // The replacement's request ID: a retry returns the same replacement.
    clientRequestId: z.uuid(PAYMENT_FORM_EXPIRED_MESSAGE),
    ...refundDetailsShape,
  }),
]);

export type VoidRefundInput = z.output<typeof voidRefundSchema>;
export type VoidRefundRequest = z.input<typeof voidRefundSchema>;

// ───────────── Payments page: Refunds view ─────────────

// The owner total's label, by the date filter.
export const REFUND_TOTAL_LABELS: Record<PaymentDateRange, string> = {
  today: "Refunds paid today",
  "7d": "Refunds paid in the last 7 days",
  "30d": "Refunds paid in the last 30 days",
};

// Where "Load more" continues from: the last row's paid time and ID.
export const refundListCursorSchema = z
  .string()
  .regex(/^\d{1,15}\.[A-Za-z0-9_-]{1,64}$/)
  .transform((text) => {
    const dot = text.indexOf(".");
    return { paidAt: new Date(Number(text.slice(0, dot))), id: text.slice(dot + 1) };
  });

export function encodeRefundListCursor(cursor: { paidAt: Date; id: string }): string {
  return `${cursor.paidAt.getTime()}.${cursor.id}`;
}
