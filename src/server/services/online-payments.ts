import "server-only";

import { getPaystackConfig, getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { formatNaira } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders";
import { hashToken, isWellFormedToken } from "@/lib/tokens";
import { getTrackingUrl } from "@/lib/tracking-link";
import { paystackTransactionSchema, type PaystackEvent, type PaystackTransaction } from "@/schemas/online-payments";
import {
  confirmOnlinePayment,
  expireOldPendingPayments,
  findOnlinePaymentByReference,
  findStalePendingPayments,
  insertPendingOnlinePayment,
  markOnlinePaymentFailed,
  recordOnlinePaymentMismatch,
  type OnlinePaymentRecord,
} from "@/server/data/online-payments";
import { findTrackedOrder } from "@/server/data/tracking";
import {
  ATTEMPT_FAILURE_CODES,
  canPayOnline,
  checkPaystackTransaction,
  generatePaystackReference,
  getFlutaFeeKobo,
  hasRecentPendingAttempt,
  RECONCILE_AFTER_MS,
  RECONCILE_BATCH,
  RECONCILE_UNTIL_MS,
  type MismatchCode,
  type OnlinePaymentRefusal,
} from "@/server/domain/online-payment";
import { getPaystackClient, PaystackError } from "@/server/integrations/paystack";

import { trySendEmail } from "./emails";

// Paystack's addresses for webhooks, in test and live mode. Not enforced yet
// (plan decision 7): Railway's client-IP header is still unconfirmed, and
// local testing arrives through a tunnel. A signed event from elsewhere is
// only logged, and enforcement is decided at launch (Feature 25).
export const PAYSTACK_WEBHOOK_IPS: readonly string[] = ["52.31.139.75", "52.49.173.169", "52.214.14.220"];

// A webhook event whose signature has been checked (plan 6.7). Only
// charge.success is processed; anything else is acknowledged and ignored.
// Throws only when handling failed, so the route answers 500 and Paystack
// retries (handling is idempotent). Logs the event name and reference only.
export async function handlePaystackEvent(event: PaystackEvent, now: Date): Promise<void> {
  if (event.event !== "charge.success") {
    logger.info(`[paystack-webhook] ${event.event} ignored`);
    return;
  }
  const txn = paystackTransactionSchema.safeParse(event.data);
  if (!txn.success) {
    logger.warn("[paystack-webhook] charge.success without the expected fields; ignored");
    return;
  }
  const outcome = await confirmPaystackPayment(txn.data, now);
  logger.info(`[paystack-webhook] charge.success for ${txn.data.reference}: ${outcome.kind}`);
}

// ───────────── Confirming a payment (plan 6.8) ─────────────

export type ConfirmOutcome =
  // Not a Fluta reference (another integration on the same account): ignored.
  | { kind: "UNKNOWN_REFERENCE" }
  // Paystack hasn't reported success (yet): nothing changes.
  | { kind: "NOT_SUCCESSFUL" }
  // Paid but not matching: recorded for review once (`recorded` false on a repeat).
  | { kind: "MISMATCH"; code: MismatchCode; recorded: boolean }
  | { kind: "CONFIRMED" }
  // Already confirmed (a duplicate webhook, or webhook and verify racing), or
  // failed for review.
  | { kind: "ALREADY_HANDLED" };

// The one place an online payment is confirmed: the webhook, the return
// page's verify, and the reconciliation job all call it. Counts each payment
// once: the check runs first, then one conditional update decides.
export async function confirmPaystackPayment(txn: PaystackTransaction, now: Date): Promise<ConfirmOutcome> {
  const config = getPaystackConfig();
  if (!config) throw new Error("Paystack isn't configured.");
  const payment = await findOnlinePaymentByReference(txn.reference);
  if (!payment || payment.source !== "ONLINE" || !payment.paystackReference) return { kind: "UNKNOWN_REFERENCE" };

  const check = checkPaystackTransaction(
    {
      amountKobo: payment.amount,
      paystackReference: payment.paystackReference,
      subaccountCode: payment.store.paystackSubaccountCode,
      mode: config.mode,
    },
    txn,
  );
  if (!check.ok) {
    if (check.reason === "NOT_SUCCESSFUL" || check.reason === "OTHER_REFERENCE") return { kind: "NOT_SUCCESSFUL" };
    return recordMismatch(payment, check.reason, txn, now);
  }

  const confirmed = await confirmOnlinePayment(
    payment.storeId,
    payment.id,
    { confirmedAt: txn.paidAt ?? now, paystackFeeAmount: txn.feesKobo },
    now,
  );
  return confirmed.status === "CONFIRMED" ? { kind: "CONFIRMED" } : { kind: "ALREADY_HANDLED" };
}

// Never counted; one AuditEvent, then one email to Fluta (none to the
// owner). A repeat of the same event records and sends nothing.
async function recordMismatch(payment: OnlinePaymentRecord, code: MismatchCode, txn: PaystackTransaction, now: Date): Promise<ConfirmOutcome> {
  const recorded = await recordOnlinePaymentMismatch(
    payment.storeId,
    payment.id,
    { code, expectedAmount: payment.amount, receivedAmount: txn.amountKobo, reference: txn.reference },
    now,
  );
  if (recorded) {
    logger.warn(`[online-payments] payment ${payment.id} needs review: ${code}`);
    await trySendEmail(
      {
        to: getServerEnv().FLUTA_ALERT_EMAIL,
        subject: `Online payment needs review: ${payment.store.name}`,
        text: [
          `A Paystack payment for ${payment.store.name}, order ${formatOrderNumber(payment.store, payment.order.orderNumber)}, didn't match and wasn't counted.`,
          `Reference: ${txn.reference}`,
          `Reason: ${code}`,
          `Expected ${formatNaira(payment.amount)}, Paystack reported ${formatNaira(txn.amountKobo)} ${txn.currency} (${txn.domain} mode).`,
          "Check it with Paystack and the store.",
        ].join("\n\n"),
      },
      "online payment review alert",
    );
  }
  return { kind: "MISMATCH", code, recorded };
}

// ───────────── Back from Paystack (plan section 7) ─────────────

export type ReturnedPaymentStatus = "CONFIRMED" | "PENDING" | "NOT_CONFIRMED";

// The return page asks once (and twice more while Paystack says it is still
// in progress). The reference must be an online payment of the order this
// token opens: the redirect itself never changes anything, only Paystack's
// own answer does.
export async function confirmReturnedPayment(token: string, reference: string, now: Date): Promise<ReturnedPaymentStatus> {
  if (!isWellFormedToken(token)) return "NOT_CONFIRMED";
  const order = await findTrackedOrder(hashToken(token));
  const payment = order?.payments.find((candidate) => candidate.source === "ONLINE" && candidate.paystackReference === reference);
  if (!payment) return "NOT_CONFIRMED";
  if (payment.status === "CONFIRMED") return "CONFIRMED";
  if (payment.status !== "PENDING") return "NOT_CONFIRMED";

  const client = getPaystackClient();
  if (!client) return "NOT_CONFIRMED";
  const txn = await client.verifyTransaction(reference);
  if (IN_PROGRESS.has(txn.status)) return "PENDING";
  const outcome = await confirmPaystackPayment(txn, now);
  return outcome.kind === "CONFIRMED" || outcome.kind === "ALREADY_HANDLED" ? confirmedNow(token, reference) : "NOT_CONFIRMED";
}

const IN_PROGRESS: ReadonlySet<string> = new Set(["ongoing", "pending", "processing", "queued"]);

// ALREADY_HANDLED can also mean failed for review: read it back.
async function confirmedNow(token: string, reference: string): Promise<ReturnedPaymentStatus> {
  const order = await findTrackedOrder(hashToken(token));
  const payment = order?.payments.find((candidate) => candidate.paystackReference === reference);
  return payment?.status === "CONFIRMED" ? "CONFIRMED" : "NOT_CONFIRMED";
}

// ───────────── The reconciliation job (plan 7.1) ─────────────

export interface ReconcileResult {
  checked: number;
  confirmed: number;
  failed: number;
  expired: number;
}

// Run with the 5-minute cron job: covers a webhook missed during a deploy, and
// keeps Pending from sticking. Attempts PENDING for 30 minutes (started in the
// last 48 hours, at most 20 a run) are verified: success confirms them,
// abandoned or failed fails them. Anything older fails without asking; a late
// webhook can still confirm it. One payment's error never stops the rest.
export async function reconcilePendingPayments(now: Date): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, confirmed: 0, failed: 0, expired: 0 };
  const client = getPaystackClient();
  if (!client) return result;

  result.expired = await expireOldPendingPayments(new Date(now.getTime() - RECONCILE_UNTIL_MS), ATTEMPT_FAILURE_CODES.expired);
  const stale = await findStalePendingPayments(
    new Date(now.getTime() - RECONCILE_AFTER_MS),
    new Date(now.getTime() - RECONCILE_UNTIL_MS),
    RECONCILE_BATCH,
  );
  for (const { storeId, paystackReference } of stale) {
    if (!paystackReference) continue;
    result.checked++;
    try {
      const txn = await client.verifyTransaction(paystackReference);
      if (txn.status === "success") {
        if ((await confirmPaystackPayment(txn, now)).kind === "CONFIRMED") result.confirmed++;
      } else if (txn.status === "abandoned" || txn.status === "failed") {
        const payment = await findOnlinePaymentByReference(paystackReference);
        if (payment) {
          await markOnlinePaymentFailed(storeId, payment.id, ATTEMPT_FAILURE_CODES[txn.status]);
          result.failed++;
        }
      }
    } catch (error) {
      const code = error instanceof PaystackError ? error.message : error instanceof Error ? error.name : "unknown error";
      logger.warn(`[online-payments] reconciling ${paystackReference} failed: ${code}`);
    }
  }
  return result;
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
