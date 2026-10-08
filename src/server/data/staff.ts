import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { getPrisma } from "./client";
import { reactivateStaffMembership } from "./memberships";

// Store members for the staff page, and deactivation and reactivation. Always
// for one store: storeId comes from the owner's membership, and a membership
// ID from the client is acted on only if it belongs to that store. Owners
// can't be deactivated (role STAFF only), so an owner can't lock themselves
// or another owner out.

// Neon round trips are slow from here; the default 5s can expire mid-write.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export async function listStoreMembers(storeId: string) {
  return getPrisma().membership.findMany({
    where: { storeId },
    select: {
      id: true,
      role: true,
      isActive: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}

export type MembershipChangeResult =
  | { ok: true; userId: string }
  | { ok: false; code: "NOT_FOUND" | "ACTIVE_MEMBERSHIP_EXISTS" };

// Deactivates an active staff membership of this store and records it. The
// person's orders and history are untouched. Their sessions are revoked by
// the caller, through Better Auth, after this commits.
export async function deactivateStaffMembership(
  storeId: string,
  membershipId: string,
  actorUserId: string,
  now: Date,
): Promise<MembershipChangeResult> {
  return getPrisma().$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, storeId, role: "STAFF", isActive: true },
      select: { userId: true },
    });
    if (!membership) return { ok: false, code: "NOT_FOUND" };

    const { count } = await tx.membership.updateMany({
      where: { id: membershipId, storeId, role: "STAFF", isActive: true },
      data: { isActive: false, deactivatedAt: now },
    });
    if (count !== 1) return { ok: false, code: "NOT_FOUND" };

    await recordStaffEvent(tx, "STAFF_DEACTIVATED", { storeId, membershipId, actorUserId, userId: membership.userId });
    return { ok: true, userId: membership.userId };
  }, TRANSACTION_OPTIONS);
}

// Turns the same membership back on, unless the person now has an active
// membership elsewhere. The audit events keep the history.
export async function reactivateStaff(
  storeId: string,
  membershipId: string,
  actorUserId: string,
): Promise<MembershipChangeResult> {
  return getPrisma().$transaction(async (tx) => {
    const result = await reactivateStaffMembership(storeId, membershipId, tx);
    if (!result.success) return { ok: false, code: result.code };

    await recordStaffEvent(tx, "STAFF_REACTIVATED", { storeId, membershipId, actorUserId, userId: result.userId });
    return { ok: true, userId: result.userId };
  }, TRANSACTION_OPTIONS);
}

async function recordStaffEvent(
  tx: Prisma.TransactionClient,
  action: "STAFF_DEACTIVATED" | "STAFF_REACTIVATED",
  { storeId, membershipId, actorUserId, userId }: { storeId: string; membershipId: string; actorUserId: string; userId: string },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      storeId,
      // Owners and staff are both store users.
      actorType: "STAFF",
      actorUserId,
      action,
      targetType: "Membership",
      targetId: membershipId,
      metadata: { userId },
    },
  });
}
