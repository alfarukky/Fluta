import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { createTestPrisma, insertThenRollBack } from "@/test/integration/db";

let prisma: PrismaClient;
let freshFold: { storeId: string; orderId: string; plainServiceId: string; perKgServiceId: string };
let cleanWaveOrderId: string;

beforeAll(async () => {
  prisma = createTestPrisma();
  const store = await prisma.store.findUniqueOrThrow({
    where: { slug: "freshfold-laundry" },
    include: { orders: { take: 1 }, services: true },
  });
  const cleanWave = await prisma.store.findUniqueOrThrow({
    where: { slug: "cleanwave-laundry" },
    include: { orders: { take: 1 } },
  });
  freshFold = {
    storeId: store.id,
    orderId: store.orders[0].id,
    plainServiceId: store.services.find((service) => service.name === "Shirt")!.id,
    perKgServiceId: store.services.find((service) => service.pricingType === "PER_KG")!.id,
  };
  cleanWaveOrderId = cleanWave.orders[0].id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("OrderLine type CHECK constraint", () => {
  const adjustment = () => ({
    storeId: freshFold.storeId,
    orderId: freshFold.orderId,
    lineType: "ADJUSTMENT" as const,
    description: "Express service",
    lineTotal: 50_000,
  });

  it("rejects an adjustment line with a quantity", async () => {
    await expect(
      prisma.orderLine.create({ data: { ...adjustment(), quantity: "1" } }),
    ).rejects.toThrow(/OrderLine_lineType_check/);
  });

  it("rejects an adjustment line with a service, unit price or estimate", async () => {
    for (const extra of [
      { serviceId: freshFold.plainServiceId },
      { unitPrice: 50_000 },
      { estimatedQuantity: "2" },
    ]) {
      await expect(prisma.orderLine.create({ data: { ...adjustment(), ...extra } })).rejects.toThrow(
        /OrderLine_lineType_check/,
      );
    }
  });

  it("accepts a plain adjustment line", async () => {
    await insertThenRollBack(prisma, (tx) => tx.orderLine.create({ data: adjustment() }));
  });

  const serviceLine = (serviceId: string, requiresQuote: boolean) => ({
    storeId: freshFold.storeId,
    orderId: freshFold.orderId,
    lineType: "SERVICE" as const,
    serviceId,
    description: "Seed service",
    pricingType: requiresQuote ? ("PER_KG" as const) : ("PER_ITEM" as const),
    requiresQuote,
    unitPrice: 80_000,
  });

  it("rejects a service line without a quantity unless it is waiting for a quote", async () => {
    await expect(
      prisma.orderLine.create({ data: serviceLine(freshFold.plainServiceId, false) }),
    ).rejects.toThrow(/OrderLine_lineType_check/);
  });

  it("accepts an unweighed quote-required line with no quantity or total", async () => {
    await insertThenRollBack(prisma, (tx) =>
      tx.orderLine.create({ data: { ...serviceLine(freshFold.perKgServiceId, true), estimatedQuantity: "5" } }),
    );
  });

  it("rejects a quote-required line with a total but no quantity, or the reverse", async () => {
    const line = serviceLine(freshFold.perKgServiceId, true);
    await expect(prisma.orderLine.create({ data: { ...line, lineTotal: 750_000 } })).rejects.toThrow(
      /OrderLine_lineType_check/,
    );
    await expect(prisma.orderLine.create({ data: { ...line, quantity: "5" } })).rejects.toThrow(
      /OrderLine_lineType_check/,
    );
  });

  it("rejects a negative unit price and a zero quantity", async () => {
    const line = serviceLine(freshFold.plainServiceId, false);
    await expect(
      prisma.orderLine.create({ data: { ...line, unitPrice: -1, quantity: "1", lineTotal: 0 } }),
    ).rejects.toThrow(/OrderLine_lineType_check/);
    await expect(
      prisma.orderLine.create({ data: { ...line, quantity: "0", lineTotal: 0 } }),
    ).rejects.toThrow(/OrderLine_lineType_check/);
  });
});

describe("composite store keys", () => {
  it("reject an order line pointing at the other store's order", async () => {
    await expect(
      prisma.orderLine.create({
        data: {
          storeId: freshFold.storeId,
          orderId: cleanWaveOrderId,
          lineType: "ADJUSTMENT",
          description: "Cross-store line",
          lineTotal: 1_000,
        },
      }),
    ).rejects.toThrow(/OrderLine_storeId_orderId_fkey/);
  });

  it("reject a payment against the other store's order", async () => {
    await expect(
      prisma.payment.create({
        data: {
          storeId: freshFold.storeId,
          orderId: cleanWaveOrderId,
          amount: 1_000,
          source: "STORE_COLLECTED",
          method: "CASH",
        },
      }),
    ).rejects.toThrow(/Payment_storeId_orderId_fkey/);
  });
});
