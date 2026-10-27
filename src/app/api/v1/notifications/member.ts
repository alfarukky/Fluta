import "server-only";

import { authorizeStoreMember } from "@/server/auth/access";
import type { BellMember } from "@/server/services/staff-notifications";

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonNoStore(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

// Session, active membership, and the Owner or Staff role, on every request.
// Riders are refused here (authorizeStoreMember's default). The store comes
// from the membership only, never from the request.
export async function authorizeBellMember(
  request: Request,
): Promise<{ ok: true; member: BellMember } | { ok: false; response: Response }> {
  const access = await authorizeStoreMember(request.headers);
  if (!access.allowed) return { ok: false, response: jsonNoStore({ ok: false }, access.status) };
  return {
    ok: true,
    member: {
      storeId: access.store.id,
      timeZone: access.store.timeZone,
      membershipId: access.membership.id,
      role: access.membership.role,
      notificationsSeenAt: access.membership.notificationsSeenAt,
    },
  };
}
