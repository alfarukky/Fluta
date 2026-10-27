import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { isCronAuthorized } from "@/server/auth/cron";
import { runMessageJob } from "@/server/services/notifications";
import { reconcilePendingPayments, type ReconcileResult } from "@/server/services/online-payments";
import { clearOldNotifications } from "@/server/services/staff-notifications";

// The scheduled job, called by the host every 5 minutes with
// "Authorization: Bearer <CRON_SECRET>": retries due customer messages (up
// to 3 attempts each), clears booking IP hashes older than 24 hours, and
// clears shared locations from orders closed more than 30 days ago, and
// checks online payments still pending with Paystack (plan 7.1), and deletes
// staff notifications older than 30 days.
// Anything else gets a bare 401 before any work is done.

export async function GET(request: Request): Promise<Response> {
  return run(request);
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}

async function run(request: Request): Promise<Response> {
  if (!isCronAuthorized(request.headers.get("authorization"), getServerEnv().CRON_SECRET)) {
    return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const now = new Date();
    const result = await runMessageJob(now);
    const payments = await reconcileSafely(now);
    const notificationsDeleted = await clearNotificationsSafely(now);
    return Response.json({ ok: true, ...result, payments, notificationsDeleted }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("[cron] the message job failed:", error instanceof Error ? error.name : "unknown error");
    return Response.json({ ok: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

// A Paystack or database problem with payments never fails the message job.
async function reconcileSafely(now: Date): Promise<ReconcileResult | null> {
  try {
    return await reconcilePendingPayments(now);
  } catch (error) {
    logger.error("[cron] reconciling online payments failed:", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}

// Nor does clearing old staff notifications.
async function clearNotificationsSafely(now: Date): Promise<number | null> {
  try {
    return await clearOldNotifications(now);
  } catch (error) {
    logger.error("[cron] clearing old staff notifications failed:", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}
