import "server-only";

import type { PlatformRole, Prisma } from "@/generated/prisma/client";

import { getPrisma } from "./client";

// What getStoreAccess() needs about a store (and the workspace shell shows).
export const STORE_ACCESS_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  timeZone: true,
  brandPrimaryColor: true,
  subscription: {
    select: {
      cancelledAt: true,
      graceDays: true,
      invoices: { where: { status: "OPEN" }, select: { dueDate: true } },
    },
  },
} satisfies Prisma.StoreSelect;

// The user's active memberships with what access checks and the workspace
// shell need about each store. Read on every workspace request (shared within
// one request only, see requireStoreMember) so a deactivated membership or a
// paused store takes effect immediately. At most two are read: one is normal,
// and more than one breaks the one-membership rule (the caller refuses).
export async function findActiveMemberships(userId: string) {
  return getPrisma().membership.findMany({
    where: { userId, isActive: true },
    select: { id: true, role: true, store: { select: STORE_ACCESS_SELECT } },
    orderBy: { id: "asc" },
    take: 2,
  });
}

export type ActiveMembership = Awaited<ReturnType<typeof findActiveMemberships>>[number];

// Read from the database on every admin request, never from the session.
export async function findPlatformRole(userId: string): Promise<PlatformRole | null> {
  const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { platformRole: true } });
  return user?.platformRole ?? null;
}
