import type { PrismaClient } from "@/generated/prisma/client";

// Deletes the seeded stores and everything they own, so the seed can run
// repeatedly. Only the stores with these slugs are touched.
export async function clearSeedStores(prisma: PrismaClient, slugs: string[]): Promise<void> {
  const stores = await prisma.store.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
  if (stores.length === 0) return;
  const storeId = { in: stores.map((store) => store.id) };

  // About 17 round trips; the 5 s default timeout is too tight on a slow link to Neon.
  await prisma.$transaction(
    [
      prisma.subscriptionInvoice.deleteMany({ where: { subscription: { storeId } } }),
      prisma.subscription.deleteMany({ where: { storeId } }),
      // Order.approvedQuoteId and QuoteRevision.orderId point at each other;
      // break the cycle by clearing the ID field directly (never `disconnect`).
      prisma.order.updateMany({ where: { storeId }, data: { approvedQuoteId: null } }),
      prisma.messageEvent.deleteMany({ where: { storeId } }),
      prisma.statusEvent.deleteMany({ where: { storeId } }),
      prisma.payment.deleteMany({ where: { storeId } }),
      prisma.refund.deleteMany({ where: { storeId } }),
      prisma.orderLine.deleteMany({ where: { storeId } }),
      prisma.quoteRevision.deleteMany({ where: { storeId } }),
      prisma.order.deleteMany({ where: { storeId } }),
      prisma.customer.deleteMany({ where: { storeId } }),
      prisma.service.deleteMany({ where: { storeId } }),
      prisma.serviceArea.deleteMany({ where: { storeId } }),
      prisma.closedDate.deleteMany({ where: { storeId } }),
      prisma.storeInvitation.deleteMany({ where: { storeId } }),
      prisma.auditEvent.deleteMany({ where: { storeId } }),
      prisma.store.deleteMany({ where: { id: storeId } }),
    ],
    { maxWait: 15_000, timeout: 60_000 },
  );
}
