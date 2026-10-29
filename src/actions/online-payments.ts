"use server";

import { logger } from "@/lib/logger";
import { startPaymentSchema } from "@/schemas/online-payments";
import { trackingTokenSchema } from "@/schemas/tracking";
import { PAYSTACK_REFERENCE_PATTERN } from "@/server/domain/online-payment";
import {
  confirmReturnedPayment as confirmReturned,
  START_PAYMENT_MESSAGES,
  startPayment,
  type ReturnedPaymentStatus,
  type StartPaymentResult,
} from "@/server/services/online-payments";

// Pay now on the customer's tracking page (/o/{token}). No sign-in: the token
// is the credential, and the service checks it (and whether the order can be
// paid online) again on every call. The raw token is never logged.

export type StartOnlinePaymentResult = StartPaymentResult | { ok: false; message: string; fieldErrors: { email: string } };

// The browser goes to checkoutUrl (always on checkout.paystack.com), or
// refreshes the order page when checkoutUrl is null.
export async function startOnlinePayment(token: unknown, request: unknown): Promise<StartOnlinePaymentResult> {
  const parsedToken = trackingTokenSchema.safeParse(token);
  if (!parsedToken.success) return { ok: false, message: START_PAYMENT_MESSAGES.invalid };
  const parsed = startPaymentSchema.safeParse(request);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Enter a valid email address";
    return { ok: false, message, fieldErrors: { email: message } };
  }

  try {
    return await startPayment(parsedToken.data, parsed.data, new Date());
  } catch (error) {
    logger.error("[online-payments] starting a payment failed:", describeError(error));
    return { ok: false, message: START_PAYMENT_MESSAGES.failed };
  }
}

// Back from Paystack: ask Paystack about this order's payment. Only the
// reference's own order (the token's) is ever checked or changed.
export async function confirmReturnedPayment(token: unknown, reference: unknown): Promise<ReturnedPaymentStatus> {
  const parsedToken = trackingTokenSchema.safeParse(token);
  if (!parsedToken.success || typeof reference !== "string" || !PAYSTACK_REFERENCE_PATTERN.test(reference)) return "NOT_CONFIRMED";
  try {
    return await confirmReturned(parsedToken.data, reference, new Date());
  } catch (error) {
    logger.error("[online-payments] checking a returned payment failed:", describeError(error));
    // The webhook or the job will still confirm it.
    return "PENDING";
  }
}

// The error's class and Prisma code only, never the message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
