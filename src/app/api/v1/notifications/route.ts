import { getUnreadNotificationCount } from "@/server/services/staff-notifications";
import type { UnreadCountResponse } from "@/types/staff-notifications";

import { authorizeBellMember, jsonNoStore } from "./member";

// The bell's unread count for the signed-in owner or staff member: a number
// only. Polled every 30 seconds while the workspace tab is visible.
export async function GET(request: Request): Promise<Response> {
  const auth = await authorizeBellMember(request);
  if (!auth.ok) return auth.response;
  const body: UnreadCountResponse = { count: await getUnreadNotificationCount(auth.member, new Date()) };
  return jsonNoStore(body);
}
