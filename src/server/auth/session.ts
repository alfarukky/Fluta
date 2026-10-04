import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { StoreRole } from "@/generated/prisma/client";

import { findPlatformRole } from "@/server/data/access";

import {
  authorizeFlutaAdmin,
  authorizeStoreMember,
  getSessionFromHeaders,
  type FlutaAdminAccess,
  type StoreMemberAccess,
} from "./access";

export const SIGN_IN_PATH = "/sign-in";
export const WORKSPACE_HOME_PATH = "/overview";
export const ADMIN_HOME_PATH = "/admin";

export async function getSession() {
  return getSessionFromHeaders(await headers());
}

// Where a signed-in user lands: Fluta admins in the admin console, everyone
// else in the store workspace (which checks their membership itself).
export async function getHomePath(userId: string): Promise<string> {
  return (await findPlatformRole(userId)) === "FLUTA_ADMIN" ? ADMIN_HOME_PATH : WORKSPACE_HOME_PATH;
}

// For server components and actions in the store workspace. Redirects to
// sign-in without a session; returns a 403 result the caller must render
// (or return) when the user may not use the workspace. Call it in every page
// and action, not only the layout: a layout doesn't stop its page rendering.
export async function requireStoreMember(
  options: { role?: StoreRole } = {},
): Promise<Exclude<StoreMemberAccess, { status: 401 }>> {
  const result = await authorizeStoreMember(await headers(), options);
  if (result.allowed || result.status !== 401) return result;
  redirect(SIGN_IN_PATH);
}

export async function requireFlutaAdmin(): Promise<Exclude<FlutaAdminAccess, { status: 401 }>> {
  const result = await authorizeFlutaAdmin(await headers());
  if (result.allowed || result.status !== 401) return result;
  redirect(SIGN_IN_PATH);
}
