import "server-only";

import type { StoreRole } from "@/generated/prisma/client";
import { findActiveMembership, findPlatformRole, type ActiveMembership } from "@/server/data/access";
import { getStoreAccess, type StoreAccess } from "@/server/domain/store-access";

import { getAuth, type Auth } from "./auth";

export type SessionUser = Auth["$Infer"]["Session"]["user"];

export type AccessDenied =
  | { allowed: false; status: 401; reason: "UNAUTHENTICATED" }
  | {
      allowed: false;
      status: 403;
      reason: "NO_ACTIVE_MEMBERSHIP" | "ROLE_NOT_PERMITTED" | "STORE_UNAVAILABLE" | "EDITING_NOT_ALLOWED" | "NOT_FLUTA_ADMIN";
    };

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

export type StoreMembershipLookup =
  | { found: false; reason: "UNAUTHENTICATED" | "NO_ACTIVE_MEMBERSHIP" }
  | { found: true; user: SessionUser; membership: ActiveMembership };

// Session → active membership (from the database, every call). The store
// always comes from the membership, never from the URL, body, query string,
// or cookies. No role check here, so the result can be shared by every
// caller in one request (see requireStoreMember).
export async function lookupStoreMembership(requestHeaders: Headers): Promise<StoreMembershipLookup> {
  const session = await getSessionFromHeaders(requestHeaders);
  if (!session) return { found: false, reason: "UNAUTHENTICATED" };

  const membership = await findActiveMembership(session.user.id);
  if (!membership) return { found: false, reason: "NO_ACTIVE_MEMBERSHIP" };
  return { found: true, user: session.user, membership };
}

// Lookup → role → getStoreAccess, for one caller's required role.
export function checkStoreMember(
  lookup: StoreMembershipLookup,
  options: { role?: StoreRole } = {},
  now = new Date(),
): StoreMemberAccess {
  if (!lookup.found) {
    return lookup.reason === "UNAUTHENTICATED"
      ? { allowed: false, status: 401, reason: lookup.reason }
      : { allowed: false, status: 403, reason: lookup.reason };
  }

  const { user, membership } = lookup;
  if (options.role && ROLE_RANK[membership.role] < ROLE_RANK[options.role]) {
    return { allowed: false, status: 403, reason: "ROLE_NOT_PERMITTED" };
  }

  const { subscription, ...store } = membership.store;
  const access = getStoreAccess(store, subscription, now);
  if (!access.canWorkOnExistingOrders) return { allowed: false, status: 403, reason: "STORE_UNAVAILABLE" };

  return { allowed: true, user, membership: { id: membership.id, role: membership.role }, store, access };
}

// For every owner editing operation (Server Action or API route): an owner of
// a store that getStoreAccess() allows to change its settings, services, and
// staff. Today that is the same rule as the membership gate above, so the
// extra refusal can't happen yet; it is kept separate so edit and view rules
// can differ later by changing getStoreAccess() alone.
export function checkOwnerCanEdit(lookup: StoreMembershipLookup, now = new Date()): StoreMemberAccess {
  const result = checkStoreMember(lookup, { role: "OWNER" }, now);
  if (result.allowed && !result.access.canEditSettings) {
    return { allowed: false, status: 403, reason: "EDITING_NOT_ALLOWED" };
  }
  return result;
}

// What an owner editing operation tells a refused caller. A store that can't
// be changed is explained as such, whichever check refused it.
export const STORE_LOCKED_MESSAGE = "Your store can't be changed right now. Contact Fluta support for help.";

export function ownerEditRefusalMessage(denied: AccessDenied, notOwnerMessage: string): string {
  if (denied.status === 401) return "Sign in again to continue.";
  return denied.reason === "STORE_UNAVAILABLE" || denied.reason === "EDITING_NOT_ALLOWED"
    ? STORE_LOCKED_MESSAGE
    : notOwnerMessage;
}

export async function authorizeOwnerCanEdit(requestHeaders: Headers, now = new Date()): Promise<StoreMemberAccess> {
  return checkOwnerCanEdit(await lookupStoreMembership(requestHeaders), now);
}

export async function authorizeStoreMember(
  requestHeaders: Headers,
  options: { role?: StoreRole } = {},
  now = new Date(),
): Promise<StoreMemberAccess> {
  return checkStoreMember(await lookupStoreMembership(requestHeaders), options, now);
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
