import { z } from "zod";

import { MAX_PASSWORD_LENGTH } from "./users";

// A Paystack webhook event, after its signature has been checked. Only the
// fields Fluta reads are kept: anything else in the body (the payer's email,
// card details) is dropped here and never passed on.
export const paystackEventSchema = z.object({
  event: z.string().min(1).max(100),
  data: z
    .object({
      reference: z.string().min(1).max(100).optional(),
    })
    .loose()
    .transform(({ reference }) => ({ reference })),
});

export type PaystackEvent = z.infer<typeof paystackEventSchema>;

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
