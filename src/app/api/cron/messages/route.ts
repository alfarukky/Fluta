import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { isCronAuthorized } from "@/server/auth/cron";
import { runMessageJob } from "@/server/services/notifications";

// The scheduled job, called by the host every 5 minutes with
// "Authorization: Bearer <CRON_SECRET>": retries due customer messages (up
// to 3 attempts each), clears booking IP hashes older than 24 hours, and
// clears shared locations from orders closed more than 30 days ago.
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
    const result = await runMessageJob(new Date());
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("[cron] the message job failed:", error instanceof Error ? error.name : "unknown error");
    return Response.json({ ok: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
