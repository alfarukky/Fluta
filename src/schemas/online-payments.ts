import { z } from "zod";

import { normalizeEmail } from "@/lib/email-address";
import { PAYSTACK_EMAIL_REQUIRED } from "@/lib/online-payment";

import { MAX_PASSWORD_LENGTH } from "./users";

// One Paystack transaction, as verify returns it (data) and as charge.success
// carries it (data): the same shape in both (Phase 3 fixtures). Only the
// fields Fluta checks are kept. The card ("authorization"), the payer, and
// the subaccount's account number are dropped here and never passed on.
export const PAYSTACK_TRANSACTION_STATUSES = [
  "abandoned",
  "failed",
  "ongoing",
  "pending",
  "processing",
  "queued",
  "reversed",
  "success",
] as const;

export const paystackTransactionSchema = z
  .object({
    status: z.enum(PAYSTACK_TRANSACTION_STATUSES),
    reference: z.string().min(1).max(100),
    amount: z.number().int(),
    currency: z.string().max(10),
    domain: z.enum(["test", "live"]),
    paid_at: z.string().nullable().optional(),
    fees: z.number().int().nullable().optional(),
    subaccount: z.object({ subaccount_code: z.string().max(100).optional() }).loose().nullable().optional(),
  })
  .transform((data) => {
    const paidAt = data.paid_at ? new Date(data.paid_at) : null;
    return {
      status: data.status,
      reference: data.reference,
      amountKobo: data.amount,
      currency: data.currency,
      domain: data.domain,
      paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
      // Paystack's own fee, in kobo.
      feesKobo: data.fees ?? null,
      // Null when Paystack sends no split details.
      subaccountCode: data.subaccount?.subaccount_code ?? null,
    };
  });

export type PaystackTransaction = z.output<typeof paystackTransactionSchema>;

// A Paystack webhook event, after its signature has been checked: its name,
// and its data still unread (charge.success reads it with
// paystackTransactionSchema; other events are ignored).
export const paystackEventSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.record(z.string(), z.unknown()),
});

export type PaystackEvent = z.infer<typeof paystackEventSchema>;

// ───────────── Pay now ─────────────

// The payer's email, required by Paystack for the receipt.
export const payerEmailSchema = z
  .string()
  .max(254, "Enter a valid email address")
  .transform((value) => normalizeEmail(value))
  .pipe(z.string().min(1, PAYSTACK_EMAIL_REQUIRED).pipe(z.email("Enter a valid email address")));

export const startPaymentSchema = z.object({ email: payerEmailSchema });

export type StartPaymentRequest = z.input<typeof startPaymentSchema>;

// ───────────── Settings → Payments: the store's settlement account ─────────────

// The bank (Paystack's bank id) and account number. Spaces and dashes in the
// account number are ignored; what's left must be exactly 10 digits (NUBAN).
export const settlementAccountSchema = z.object({
  bankId: z
    .string()
    .trim()
    .regex(/^\d{1,10}$/, "Choose your bank"),
  accountNumber: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\d{10}$/, "Enter your 10-digit account number")),
});

// The account name the owner confirmed ("Is this your account?"). The server
// compares it with its own lookup of the account; it is never saved.
const confirmedAccountName = z.string().trim().min(1, "Check the account first").max(200);

export const connectAccountSchema = settlementAccountSchema.extend({
  businessName: z
    .string()
    .trim()
    .min(2, "Business name must be at least 2 characters")
    .max(100, "Business name must be 100 characters or fewer"),
  accountName: confirmedAccountName,
});

// Changing the bank account also needs the owner's password (plan 4.3).
export const changeAccountSchema = settlementAccountSchema.extend({
  accountName: confirmedAccountName,
  password: z.string().min(1, "Enter your password").max(MAX_PASSWORD_LENGTH, "Enter your password"),
});

export type SettlementAccountInput = z.infer<typeof settlementAccountSchema>;
export type ConnectAccountInput = z.infer<typeof connectAccountSchema>;
export type ChangeAccountInput = z.infer<typeof changeAccountSchema>;
