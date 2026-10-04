import "server-only";

import type { PlatformRole } from "@/generated/prisma/client";

import { getPrisma } from "./client";

// The user's active membership with what access checks need about its store.
// Never cached: called on every workspace request so a deactivated membership
// or a paused store takes effect immediately.
export async function findActiveMembership(userId: string) {
  return getPrisma().membership.findFirst({
    where: { userId, isActive: true },
    select: {
      id: true,
      role: true,
      store: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          timeZone: true,
          subscription: {
            select: {
              cancelledAt: true,
              graceDays: true,
              invoices: { where: { status: "OPEN" }, select: { dueDate: true } },
            },
          },
        },
      },
    },
  });
}

export type ActiveMembership = NonNullable<Awaited<ReturnType<typeof findActiveMembership>>>;

// Read from the database on every admin request, never from the session.
export async function findPlatformRole(userId: string): Promise<PlatformRole | null> {
  const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { platformRole: true } });
  return user?.platformRole ?? null;
}
