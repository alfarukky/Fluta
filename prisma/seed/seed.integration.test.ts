import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { createTestPrisma } from "@/test/integration/db";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// balance = approved total − confirmed payments + refunds paid (cancelled: total 0).
async function balanceOf(orderId: string): Promise<number> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { approvedQuote: true, payments: true, refunds: true },
  });
  const total = order.stage === "CANCELLED" ? 0 : (order.approvedQuote?.total ?? 0);
  const paid = order.payments
    .filter((payment) => payment.status === "CONFIRMED")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const refunded = order.refunds
    .filter((refund) => refund.voidedAt === null)
    .reduce((sum, refund) => sum + refund.amount, 0);
  return total - paid + refunded;
}

describe("seed data", () => {
  it("creates FreshFold with orders in every stage, numbered from nextOrderNumber", async () => {
    const store = await prisma.store.findUniqueOrThrow({
      where: { slug: "freshfold-laundry" },
      include: { orders: { orderBy: { orderNumber: "asc" } }, customers: true, subscription: true },
    });
    expect(store).toMatchObject({ orderPrefix: "FF", timeZone: "Africa/Lagos", brandPrimaryColor: "#173C32" });
    expect(store.customers.length).toBeGreaterThanOrEqual(8);
    expect(store.subscription).not.toBeNull();

    const numbers = store.orders.map((order) => order.orderNumber);
    expect(numbers).toEqual(numbers.map((_, index) => 1001 + index));
    expect(store.nextOrderNumber).toBe(1001 + numbers.length);

    const stages = new Set(store.orders.map((order) => order.stage));
    expect([...stages].sort()).toEqual(
      [
        "BOOKED",
        "PICKUP_SCHEDULED",
        "PICKED_UP",
        "RECEIVED_BY_STORE",
        "QUOTE_AWAITING_APPROVAL",
        "IN_PROGRESS",
        "READY",
        "OUT_FOR_DELIVERY",
        "COMPLETED",
        "CANCELLED",
      ].sort(),
    );
  });

  it("gives every order a version 1 revision and a first status event", async () => {
    const orders = await prisma.order.findMany({
      include: { quoteRevisions: true, statusEvents: { orderBy: { createdAt: "asc" } } },
    });
    for (const order of orders) {
      expect(order.quoteRevisions.map((revision) => revision.version)).toContain(1);
      expect(order.statusEvents[0]?.fromStage).toBeNull();
      expect(order.statusEvents.at(-1)?.toStage).toBe(order.stage);
    }
  });

  it("includes one refund-owed order and one cancelled order", async () => {
    const orders = await prisma.order.findMany({ where: { store: { slug: "freshfold-laundry" } } });
    const balances = await Promise.all(orders.map((order) => balanceOf(order.id)));
    expect(balances.filter((balance) => balance < 0)).toEqual([-150_000]);
    expect(orders.filter((order) => order.stage === "CANCELLED")).toHaveLength(1);
  });

  it("keeps the same phone number as separate customers per store", async () => {
    const customers = await prisma.customer.findMany({ where: { phone: "+2348030000101" } });
    expect(new Set(customers.map((customer) => customer.storeId)).size).toBe(2);
  });
});
