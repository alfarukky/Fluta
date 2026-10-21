import "server-only";

import { logger } from "@/lib/logger";
import type { PaystackEvent } from "@/schemas/online-payments";

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
