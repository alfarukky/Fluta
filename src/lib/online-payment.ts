// Customer-facing wording for online payment, shared by the booking page,
// the tracking page, and the server.

// The anti-fraud line on every payment step (plan 3.6): Fluta never shows an
// account number to transfer to.
export function getTransferWarning(storeName: string): string {
  return `${storeName} will never ask you to transfer money to a personal account.`;
}

// Pay now's line: where the customer pays, and the warning.
export function getPaymentWarning(storeName: string): string {
  return `You'll pay on Paystack's secure page. ${getTransferWarning(storeName)}`;
}

export const PAYSTACK_EMAIL_HINT = "For your Paystack receipt";
export const PAYSTACK_EMAIL_REQUIRED = "Enter your email for your Paystack receipt";

// A successful Paystack transaction that doesn't match what Fluta asked for.
// A payment failed with one of these stays for review ("Payment needs
// review"): it is never confirmed by a retried webhook or verify.
export const MISMATCH_CODES = ["AMOUNT_MISMATCH", "CURRENCY_MISMATCH", "MODE_MISMATCH", "SUBACCOUNT_MISMATCH"] as const;
export type MismatchCode = (typeof MISMATCH_CODES)[number];

export function isMismatchCode(code: string | null): code is MismatchCode {
  return code !== null && (MISMATCH_CODES as readonly string[]).includes(code);
}
