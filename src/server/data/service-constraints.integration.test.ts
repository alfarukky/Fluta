import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient, Service } from "@/generated/prisma/client";
import { createTestPrisma, insertThenRollBack } from "@/test/integration/db";

let prisma: PrismaClient;
let storeId: string;
let perItem: Service;

beforeAll(async () => {
  prisma = createTestPrisma();
  const store = await prisma.store.findUniqueOrThrow({
    where: { slug: "freshfold-laundry" },
    include: { services: true },
  });
  storeId = store.id;
  perItem = store.services.find((service) => service.name === "Shirt")!;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const newService = (pricingType: "PER_ITEM" | "PER_PACKAGE", requiresQuote: boolean) => ({
  storeId,
  name: "Constraint check",
  nameKey: "constraint check",
  pricingType,
  price: 100_000,
  requiresQuote,
});

describe("Service pricing types", () => {
  it("accepts no type but per item and per package", async () => {
    await expect(
      prisma.$executeRaw`UPDATE "Service" SET "pricingType" = 'PER_HOUR' WHERE "id" = ${perItem.id}`,
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it("accepts per item and per package, with or without quote required", async () => {
    for (const pricingType of ["PER_ITEM", "PER_PACKAGE"] as const) {
      for (const requiresQuote of [true, false]) {
        await insertThenRollBack(prisma, (tx) => tx.service.create({ data: newService(pricingType, requiresQuote) }));
      }
    }
  });
});

describe("Service name key", () => {
  it("is unique within a store", async () => {
    await expect(
      prisma.service.create({ data: { ...newService("PER_ITEM", false), name: perItem.name, nameKey: perItem.nameKey } }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("was filled for seeded services as the lowercased, trimmed name", async () => {
    const services = await prisma.service.findMany({ where: { storeId } });
    for (const service of services) expect(service.nameKey).toBe(service.name.trim().replace(/\s+/g, " ").toLowerCase());
  });
});
