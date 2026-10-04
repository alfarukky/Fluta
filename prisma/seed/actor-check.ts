import type { PrismaClient } from "@/generated/prisma/client";

// Every user ID recorded as an actor in the seeded stores' data must belong to
// a real user. Throws, naming the column, if any doesn't.
export async function assertActorIdsExist(prisma: PrismaClient, storeIds: string[]): Promise<void> {
  const storeId = { in: storeIds };
  const [orders, revisions, payments, refunds, statusEvents, messages, audits, invitations, invoices] =
    await Promise.all([
      prisma.order.findMany({ where: { storeId }, select: { createdByUserId: true } }),
      prisma.quoteRevision.findMany({ where: { storeId }, select: { createdByUserId: true } }),
      prisma.payment.findMany({ where: { storeId }, select: { recordedByUserId: true, voidedByUserId: true } }),
      prisma.refund.findMany({ where: { storeId }, select: { recordedByUserId: true, voidedByUserId: true } }),
      prisma.statusEvent.findMany({ where: { storeId }, select: { actorUserId: true } }),
      prisma.messageEvent.findMany({ where: { storeId }, select: { createdByUserId: true } }),
      prisma.auditEvent.findMany({ where: { storeId }, select: { actorUserId: true } }),
      prisma.storeInvitation.findMany({ where: { storeId }, select: { invitedByUserId: true } }),
      prisma.subscriptionInvoice.findMany({
        where: { subscription: { storeId } },
        select: { recordedByUserId: true },
      }),
    ]);

  const referenced: [column: string, ids: (string | null)[]][] = [
    ["Order.createdByUserId", orders.map((row) => row.createdByUserId)],
    ["QuoteRevision.createdByUserId", revisions.map((row) => row.createdByUserId)],
    ["Payment.recordedByUserId", payments.map((row) => row.recordedByUserId)],
    ["Payment.voidedByUserId", payments.map((row) => row.voidedByUserId)],
    ["Refund.recordedByUserId", refunds.map((row) => row.recordedByUserId)],
    ["Refund.voidedByUserId", refunds.map((row) => row.voidedByUserId)],
    ["StatusEvent.actorUserId", statusEvents.map((row) => row.actorUserId)],
    ["MessageEvent.createdByUserId", messages.map((row) => row.createdByUserId)],
    ["AuditEvent.actorUserId", audits.map((row) => row.actorUserId)],
    ["StoreInvitation.invitedByUserId", invitations.map((row) => row.invitedByUserId)],
    ["SubscriptionInvoice.recordedByUserId", invoices.map((row) => row.recordedByUserId)],
  ];
  const allIds = [...new Set(referenced.flatMap(([, ids]) => ids).filter((id): id is string => id !== null))];
  const users = await prisma.user.findMany({ where: { id: { in: allIds } }, select: { id: true } });
  const known = new Set(users.map((user) => user.id));

  const problems = referenced.flatMap(([column, ids]) => {
    const unknown = [...new Set(ids.filter((id): id is string => id !== null && !known.has(id)))];
    return unknown.length > 0 ? [`  - ${column}: ${unknown.join(", ")}`] : [];
  });
  if (problems.length > 0) {
    throw new Error(`Seed data references users that don't exist:\n${problems.join("\n")}`);
  }
}
