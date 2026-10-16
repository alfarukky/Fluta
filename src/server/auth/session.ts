import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getWorkspaceHome } from "@/components/workspace/nav-items";
import { findActiveMemberships, findPlatformRole } from "@/server/data/access";

import {
  authorizeFlutaAdmin,
  checkOwnerCanEdit,
  checkStoreMember,
  getSessionFromHeaders,
  lookupStoreMembership,
  type FlutaAdminAccess,
  type StoreMemberAccess,
  type StoreMemberOptions,
} from "./access";

export const SIGN_IN_PATH = "/sign-in";
export const ADMIN_HOME_PATH = "/admin";

export async function getSession() {
  return getSessionFromHeaders(await headers());
}

// Where a signed-in user lands, decided here only: Fluta admins in the admin
// console, riders in Deliveries, owners and staff in Overview. Anyone without
// exactly one active membership goes to Overview, which refuses them itself.
export async function getHomePath(userId: string): Promise<string> {
  if ((await findPlatformRole(userId)) === "FLUTA_ADMIN") return ADMIN_HOME_PATH;
  const memberships = await findActiveMemberships(userId);
  return getWorkspaceHome(memberships.length === 1 ? memberships[0].role : null);
}

// One session + membership lookup per request, shared by the layout and the
// page. React's cache() lasts for a single server render only: nothing is
// kept across requests or stored in the session, so a deactivated membership
// is refused on the next request. Role and store-access checks run on every
// call, outside the cache.
const lookupCurrentStoreMembership = cache(async () => lookupStoreMembership(await headers()));

// For server components and actions in the store workspace. Redirects to
// sign-in without a session; returns a 403 result the caller must render
// (or return) when the user may not use the workspace. Call it in every page
// and action, not only the layout: a layout doesn't stop its page rendering.
// Riders are refused unless the caller passes { allowRider: true }.
export async function requireStoreMember(
  options: StoreMemberOptions = {},
): Promise<Exclude<StoreMemberAccess, { status: 401 }>> {
  const result = checkStoreMember(await lookupCurrentStoreMembership(), options);
  if (result.allowed || result.status !== 401) return result;
  redirect(SIGN_IN_PATH);
}

// For every owner editing action: requireStoreMember({ role: "OWNER" }) plus
// getStoreAccess()'s canEditSettings (see checkOwnerCanEdit). Pages keep using
// requireStoreMember, so viewing follows the membership gate alone.
export async function requireOwnerCanEdit(): Promise<Exclude<StoreMemberAccess, { status: 401 }>> {
  const result = checkOwnerCanEdit(await lookupCurrentStoreMembership());
  if (result.allowed || result.status !== 401) return result;
  redirect(SIGN_IN_PATH);
}

export async function requireFlutaAdmin(): Promise<Exclude<FlutaAdminAccess, { status: 401 }>> {
  const result = await authorizeFlutaAdmin(await headers());
  if (result.allowed || result.status !== 401) return result;
  redirect(SIGN_IN_PATH);
}
