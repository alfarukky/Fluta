import "server-only";

import { logger } from "@/lib/logger";
import { formatOrderNumber } from "@/lib/orders";
import { hashToken, isWellFormedToken } from "@/lib/tokens";
import { getTrackingUrl } from "@/lib/tracking-link";
import type { PaystackEvent } from "@/schemas/online-payments";
import { insertPendingOnlinePayment, markOnlinePaymentFailed } from "@/server/data/online-payments";
import { findTrackedOrder } from "@/server/data/tracking";
import {
  canPayOnline,
  generatePaystackReference,
  getFlutaFeeKobo,
  hasRecentPendingAttempt,
  type OnlinePaymentRefusal,
} from "@/server/domain/online-payment";
import { getPaystackClient, PaystackError } from "@/server/integrations/paystack";

// Paystack's addresses for webhooks, in test and live mode. Not enforced yet
// (plan decision 7): Railway's client-IP header is still unconfirmed, and
// local testing arrives through a tunnel. A signed event from elsewhere is
// only logged, and enforcement is decided at launch (Feature 25).
export const PAYSTACK_WEBHOOK_IPS: readonly string[] = ["52.31.139.75", "52.49.173.169", "52.214.14.220"];

// A webhook event whose signature has been checked. Phase 1 only
// acknowledges events: confirming payments from charge.success comes in
// Phase 4. Logs only the event name and Paystack reference.
export async function handlePaystackEvent(event: PaystackEvent): Promise<void> {
  const reference = event.data.reference ?? "none";
  if (event.event === "charge.success") {
    logger.info(`[paystack-webhook] charge.success received (reference ${reference}); not processed yet`);
    return;
  }
  logger.info(`[paystack-webhook] ${event.event} ignored (reference ${reference})`);
}

// ───────────── Starting a payment (plan section 7) ─────────────

export type StartPaymentResult =
  // Paystack's checkout page: the browser goes straight there.
  | { ok: true; checkoutUrl: string }
  // A repeated Book and pay while an attempt under 15 minutes old is still
  // pending: nothing new starts, and the customer goes to their order page.
  | { ok: true; checkoutUrl: null }
  | { ok: false; message: string };

export const START_PAYMENT_MESSAGES = {
  invalid: "This link may have been replaced by a newer message from the store. Please open the latest message, or call the store.",
  unavailable: "Online payment isn't available for this order. Please pay the store directly.",
  failed: "We couldn't start your payment. Please try again.",
  // Paystack refuses a payment whose store share can't cover its fees (plan 6.3).
  tooSmall: "This amount can't be paid online. Please pay the store directly.",
} as const;

function refusalMessage(reason: OnlinePaymentRefusal | "RECENT_ATTEMPT", storeName: string): string {
  switch (reason) {
    case "NOT_CONNECTED":
    case "RECENT_ATTEMPT":
      return START_PAYMENT_MESSAGES.unavailable;
    case "STORE_UNAVAILABLE":
      return "This order is no longer available.";
    case "LINK_EXPIRED":
      return `This link has expired. Please contact ${storeName}.`;
    case "ORDER_CANCELLED":
      return "This order is cancelled, so there's nothing to pay.";
    case "NOTHING_DUE":
      return "There's nothing to pay on this order right now.";
    case "PRICE_UPDATE_PENDING":
      return "Please review the price update first.";
  }
}

export interface StartPaymentOptions {
  // Book and pay: a PENDING attempt under 15 minutes old means this is a
  // repeated submit, so no new payment starts.
  skipIfRecentPending?: boolean;
}

// The order the tracking token opens, paid in full online. Write first, call
// after: the PENDING Payment (with Fluta's reference, the amount, the payer's
// email, and Fluta's fee) is committed before Paystack is called. If Paystack
// refuses or fails, the attempt is marked FAILED with a short code and never
// counts. Nothing here confirms a payment (Phase 4).
export async function startPayment(
  token: string,
  request: { email: string },
  now: Date,
  options: StartPaymentOptions = {},
): Promise<StartPaymentResult> {
  if (!isWellFormedToken(token)) return { ok: false, message: START_PAYMENT_MESSAGES.invalid };
  const order = await findTrackedOrder(hashToken(token));
  if (!order) return { ok: false, message: START_PAYMENT_MESSAGES.invalid };
  const client = getPaystackClient();
  if (!client) return { ok: false, message: START_PAYMENT_MESSAGES.unavailable };

  const reference = generatePaystackReference();
  const outcome = await insertPendingOnlinePayment<OnlinePaymentRefusal | "RECENT_ATTEMPT">(
    order.storeId,
    order.id,
    (current) => {
      // Checked under the order's lock, so a double tap starts one payment.
      if (options.skipIfRecentPending && hasRecentPendingAttempt(current.payments, now)) {
        return { ok: false, refusal: "RECENT_ATTEMPT" };
      }
      const decision = canPayOnline(current, current.store, now);
      if (!decision.allowed) return { ok: false, refusal: decision.reason };
      return {
        ok: true,
        payment: {
          amount: decision.amountKobo,
          paystackReference: reference,
          payerEmail: request.email,
          flutaFeeBps: current.store.onlineFeeBps,
          flutaFeeAmount: getFlutaFeeKobo(decision.amountKobo, current.store.onlineFeeBps),
        },
      };
    },
    now,
  );
  if (outcome.status === "NOT_FOUND") return { ok: false, message: START_PAYMENT_MESSAGES.invalid };
  if (outcome.status === "REFUSED") {
    if (outcome.refusal === "RECENT_ATTEMPT") return { ok: true, checkoutUrl: null };
    return { ok: false, message: refusalMessage(outcome.refusal, order.store.name) };
  }

  const { paymentId, payment, subaccountCode, currency } = outcome;
  // The callback and cancel URLs hold the raw token (accepted, plan 6.5):
  // never log them, and never put the token in metadata.
  const orderUrl = getTrackingUrl(token);
  try {
    const started = await client.initializeTransaction({
      amountKobo: payment.amount,
      email: payment.payerEmail,
      currency,
      reference,
      callbackUrl: `${orderUrl}?paystack=return`,
      subaccountCode,
      transactionChargeKobo: payment.flutaFeeAmount,
      metadata: {
        payment_id: paymentId,
        order_id: order.id,
        store_id: order.storeId,
        cancel_action: orderUrl,
        custom_fields: [
          { display_name: "Order", variable_name: "order_number", value: formatOrderNumber(order.store, order.orderNumber) },
        ],
      },
    });
    if (started.reference !== reference) {
      await markOnlinePaymentFailed(order.storeId, paymentId, "initialize reference mismatch");
      logger.error(`[online-payments] Paystack returned another reference for payment ${paymentId}`);
      return { ok: false, message: START_PAYMENT_MESSAGES.failed };
    }
    return { ok: true, checkoutUrl: started.authorizationUrl };
  } catch (error) {
    const code = error instanceof PaystackError ? error.message : "error";
    await markOnlinePaymentFailed(order.storeId, paymentId, `initialize ${code}`);
    logger.warn(`[online-payments] starting payment ${paymentId} failed: ${code}`);
    if (!(error instanceof PaystackError)) throw error;
    return { ok: false, message: code.startsWith("HTTP 400") ? START_PAYMENT_MESSAGES.tooSmall : START_PAYMENT_MESSAGES.failed };
  }
}
