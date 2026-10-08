import "server-only";

import type { Prisma, PrismaClient, StoreRole } from "@/generated/prisma/client";

// Neon round trips are slow from here; the default 5s can expire mid-write.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

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
  return db.$transaction((tx) => addMembership(storeId, input, tx), TRANSACTION_OPTIONS);
}

// The same, inside the caller's transaction (invitation acceptance). A user
// who was deactivated here before gets that membership back rather than a
// second one (one membership per user and store).
export async function addMembership(
  storeId: string,
  input: { userId: string; role: StoreRole },
  tx: Prisma.TransactionClient,
): Promise<CreateMembershipResult> {
  if (await hasActiveMembership(input.userId, tx)) return { success: false, code: "ACTIVE_MEMBERSHIP_EXISTS" };

  const membership = await tx.membership.upsert({
    where: { userId_storeId: { userId: input.userId, storeId } },
    create: { storeId, userId: input.userId, role: input.role },
    update: { role: input.role, isActive: true, deactivatedAt: null },
    select: { id: true },
  });
  return { success: true, membershipId: membership.id };
}

export type ReactivateMembershipResult =
  | { success: true; userId: string }
  | { success: false; code: "NOT_FOUND" | "ACTIVE_MEMBERSHIP_EXISTS" };

// Turns a deactivated staff membership of this store back on, unless the user
// has an active membership anywhere (the one-membership rule). Owners are
// never changed here.
export async function reactivateStaffMembership(
  storeId: string,
  membershipId: string,
  tx: Prisma.TransactionClient,
): Promise<ReactivateMembershipResult> {
  const membership = await tx.membership.findFirst({
    where: { id: membershipId, storeId, role: "STAFF", isActive: false },
    select: { userId: true },
  });
  if (!membership) return { success: false, code: "NOT_FOUND" };
  if (await hasActiveMembership(membership.userId, tx)) return { success: false, code: "ACTIVE_MEMBERSHIP_EXISTS" };

  const { count } = await tx.membership.updateMany({
    where: { id: membershipId, storeId, role: "STAFF", isActive: false },
    data: { isActive: true, deactivatedAt: null },
  });
  return count === 1 ? { success: true, userId: membership.userId } : { success: false, code: "NOT_FOUND" };
}

// Locks the user's row first, so two concurrent membership changes for one
// user can't both pass the check.
async function hasActiveMembership(userId: string, tx: Prisma.TransactionClient): Promise<boolean> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const active = await tx.membership.findFirst({ where: { userId, isActive: true }, select: { id: true } });
  return active !== null;
}
