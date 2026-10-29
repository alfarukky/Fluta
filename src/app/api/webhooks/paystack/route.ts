import { getClientIp } from "@/lib/client-ip";
import { getPaystackConfig } from "@/lib/env";
import { logger } from "@/lib/logger";
import { readBodyWithLimit } from "@/lib/read-body";
import { paystackEventSchema } from "@/schemas/online-payments";
import { isValidPaystackSignature } from "@/server/integrations/paystack";
import { handlePaystackEvent, PAYSTACK_WEBHOOK_IPS } from "@/server/services/online-payments";

// Paystack's server-to-server events. Not a browser request: no Origin check
// and no session. The signature on the exact raw bytes is the only
// credential, so the body is read once as bytes, checked, and only then
// parsed. Paystack retries anything but 200, so every correctly signed event
// gets 200 unless handling it failed. Only POST is exported; other methods
// get 405.

const WEBHOOK_MAX_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const config = getPaystackConfig();
  if (!config) return new Response(null, { status: 404 });

  const body = await readBodyWithLimit(request, WEBHOOK_MAX_BYTES);
  if (!body.ok) return new Response(null, { status: 400 });
  if (!isValidPaystackSignature(body.bytes, request.headers.get("x-paystack-signature"), config.secretKey)) {
    logger.warn("[paystack-webhook] refused: invalid signature");
    return new Response(null, { status: 401 });
  }

  const ip = getClientIp(request.headers);
  if (!ip || !PAYSTACK_WEBHOOK_IPS.includes(ip)) {
    logger.warn(`[paystack-webhook] signed event from outside Paystack's addresses (${ip ?? "unknown address"})`);
  }

  const event = paystackEventSchema.safeParse(parseJson(body.bytes));
  if (!event.success) {
    // Signed, but not an event Fluta reads.
    logger.warn("[paystack-webhook] signed body is not an event; ignored");
    return new Response(null, { status: 200 });
  }
  try {
    await handlePaystackEvent(event.data, new Date());
    return new Response(null, { status: 200 });
  } catch (error) {
    // Paystack retries, and handling is idempotent.
    logger.error(`[paystack-webhook] handling ${event.data.event} failed:`, error instanceof Error ? error.name : "unknown error");
    return new Response(null, { status: 500 });
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}
