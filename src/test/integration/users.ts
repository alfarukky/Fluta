import { randomUUID } from "node:crypto";

import type { PrismaClient, StoreRole } from "@/generated/prisma/client";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";

// Throwaway people for staff and invitation tests, on their own reserved
// domain so cleanup can find everything they touched.
export const TEST_EMAIL_DOMAIN = "staff-test.example";
export const TEST_USER_PASSWORD = "test-password-1234";

export function testEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@${TEST_EMAIL_DOMAIN}`;
}

export async function createTestUser(
  prisma: PrismaClient,
  label: string,
  membership?: { storeId: string; role?: StoreRole },
): Promise<{ id: string; email: string; membershipId: string | null }> {
  const email = testEmail(label);
  const { id } = await createUserWithPassword({ name: `Test ${label}`, email, password: TEST_USER_PASSWORD }, prisma);
  if (!membership) return { id, email, membershipId: null };

  const result = await createMembership(membership.storeId, { userId: id, role: membership.role ?? "STAFF" }, prisma);
  if (!result.success) throw new Error(`Couldn't add ${email} to the store`);
  return { id, email, membershipId: result.membershipId };
}

// Test cleanup only (the app never deletes users or invitations): everything
// belonging to users and invitations on the test domain.
export async function deleteTestPeople(prisma: PrismaClient): Promise<void> {
  const onDomain = { endsWith: `@${TEST_EMAIL_DOMAIN}` };
  const users = await prisma.user.findMany({ where: { email: onDomain }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  const memberships = await prisma.membership.findMany({ where: { userId: { in: userIds } }, select: { id: true } });

  await prisma.$transaction(
    [
      prisma.auditEvent.deleteMany({ where: { targetId: { in: memberships.map((membership) => membership.id) } } }),
      prisma.storeInvitation.deleteMany({ where: { email: onDomain } }),
      prisma.membership.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.session.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.account.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ],
    { maxWait: 15_000, timeout: 30_000 },
  );
}
