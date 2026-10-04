import "server-only";

import type { StoreRole } from "@/generated/prisma/client";
import { findActiveMembership, findPlatformRole, type ActiveMembership } from "@/server/data/access";
import { getStoreAccess, type StoreAccess } from "@/server/domain/store-access";

import { getAuth, type Auth } from "./auth";

export type SessionUser = Auth["$Infer"]["Session"]["user"];

export type AccessDenied =
  | { allowed: false; status: 401; reason: "UNAUTHENTICATED" }
  | { allowed: false; status: 403; reason: "NO_ACTIVE_MEMBERSHIP" | "ROLE_NOT_PERMITTED" | "STORE_UNAVAILABLE" | "NOT_FLUTA_ADMIN" };

export type StoreMemberAccess =
  | {
      allowed: true;
      user: SessionUser;
      membership: Pick<ActiveMembership, "id" | "role">;
      store: Omit<ActiveMembership["store"], "subscription">;
      access: StoreAccess;
    }
  | AccessDenied;

export type FlutaAdminAccess = { allowed: true; user: SessionUser } | AccessDenied;

// Owners can do everything staff can.
const ROLE_RANK: Record<StoreRole, number> = { STAFF: 0, OWNER: 1 };

export async function getSessionFromHeaders(requestHeaders: Headers) {
  return getAuth().api.getSession({ headers: requestHeaders });
}

// Session → active membership (from the database, every call) → role →
// getStoreAccess. The store always comes from the membership, never from the
// URL, body, query string, or cookies.
export async function authorizeStoreMember(
  requestHeaders: Headers,
  options: { role?: StoreRole } = {},
  now = new Date(),
): Promise<StoreMemberAccess> {
  const session = await getSessionFromHeaders(requestHeaders);
  if (!session) return { allowed: false, status: 401, reason: "UNAUTHENTICATED" };

  const membership = await findActiveMembership(session.user.id);
  if (!membership) return { allowed: false, status: 403, reason: "NO_ACTIVE_MEMBERSHIP" };
  if (options.role && ROLE_RANK[membership.role] < ROLE_RANK[options.role]) {
    return { allowed: false, status: 403, reason: "ROLE_NOT_PERMITTED" };
  }

  const { subscription, ...store } = membership.store;
  const access = getStoreAccess(store, subscription, now);
  if (!access.canWorkOnExistingOrders) return { allowed: false, status: 403, reason: "STORE_UNAVAILABLE" };

  return { allowed: true, user: session.user, membership: { id: membership.id, role: membership.role }, store, access };
}

// platformRole is read from the database on every call, never from the session.
export async function authorizeFlutaAdmin(requestHeaders: Headers): Promise<FlutaAdminAccess> {
  const session = await getSessionFromHeaders(requestHeaders);
  if (!session) return { allowed: false, status: 401, reason: "UNAUTHENTICATED" };
  if ((await findPlatformRole(session.user.id)) !== "FLUTA_ADMIN") {
    return { allowed: false, status: 403, reason: "NOT_FLUTA_ADMIN" };
  }
  return { allowed: true, user: session.user };
}
