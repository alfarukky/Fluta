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
