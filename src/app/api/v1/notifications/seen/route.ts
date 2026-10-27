import { getServerEnv } from "@/lib/env";
import { openNotificationBell } from "@/server/services/staff-notifications";
import type { OpenedNotificationsResponse } from "@/types/staff-notifications";

import { authorizeBellMember, jsonNoStore } from "../member";

// Opening the bell: marks everything up to now seen for this member only,
// and returns the newest notifications up to that moment.
export async function POST(request: Request): Promise<Response> {
  // Route handlers get no CSRF protection from Next.js, so only the app's own
  // pages may post here.
  if (request.headers.get("origin") !== new URL(getServerEnv().BETTER_AUTH_URL).origin) {
    return jsonNoStore({ ok: false }, 403);
  }
  const auth = await authorizeBellMember(request);
  if (!auth.ok) return auth.response;

  const items = await openNotificationBell(auth.member);
  if (!items) return jsonNoStore({ ok: false }, 403);
  const body: OpenedNotificationsResponse = { items };
  return jsonNoStore(body);
}
