// Railway's cron service runs this every 5 minutes (railway.cron.json): one
// call to the app's scheduled job, then exit. Standalone, so it reads its two
// variables directly rather than through src/lib/env.ts:
//   CRON_URL     the job's full address, e.g. https://fluta-staging.up.railway.app/api/cron/messages
//   CRON_SECRET  the same secret the app has
// Logs only the HTTP status: never the secret or the response body.
const url = process.env.CRON_URL;
const secret = process.env.CRON_SECRET;

if (!url?.startsWith("https://") || !secret) {
  console.error("[cron] CRON_URL (https) and CRON_SECRET are required");
  process.exit(1);
}

try {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(60_000),
  });
  console.log(`[cron] scheduled job answered ${response.status}`);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(`[cron] scheduled job call failed: ${error instanceof Error ? error.name : "unknown error"}`);
  process.exit(1);
}
