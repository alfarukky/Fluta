import "server-only";

import type { PrismaClient, StoreRole } from "@/generated/prisma/client";

export type CreateMembershipResult =
  | { success: true; membershipId: string }
  | { success: false; code: "ACTIVE_MEMBERSHIP_EXISTS" };

// The only function that creates memberships. In the MVP a user belongs to at
// most one store at a time, so a second active membership is refused.
export async function createMembership(
  storeId: string,
  input: { userId: string; role: StoreRole },
  db: PrismaClient,
): Promise<CreateMembershipResult> {
  return db.$transaction(async (tx) => {
    // Lock the user's row so two concurrent calls can't both pass the check.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
    const active = await tx.membership.findFirst({
      where: { userId: input.userId, isActive: true },
      select: { id: true },
    });
    if (active) return { success: false, code: "ACTIVE_MEMBERSHIP_EXISTS" };

    const membership = await tx.membership.create({
      data: { storeId, userId: input.userId, role: input.role },
      select: { id: true },
    });
    return { success: true, membershipId: membership.id };
  });
}
