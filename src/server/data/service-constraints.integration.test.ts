import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient, Service } from "@/generated/prisma/client";
import { createTestPrisma, insertThenRollBack } from "@/test/integration/db";

let prisma: PrismaClient;
let storeId: string;
let perKg: Service;
let perItem: Service;

beforeAll(async () => {
  prisma = createTestPrisma();
  const store = await prisma.store.findUniqueOrThrow({
    where: { slug: "freshfold-laundry" },
    include: { services: true },
  });
  storeId = store.id;
  perKg = store.services.find((service) => service.pricingType === "PER_KG")!;
  perItem = store.services.find((service) => service.name === "Shirt")!;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const newService = (pricingType: "PER_KG" | "PER_ITEM", requiresQuote: boolean) => ({
  storeId,
  name: "Constraint check",
  nameKey: "constraint check",
  pricingType,
  price: 100_000,
  requiresQuote,
});

describe("Service per-kg CHECK constraint", () => {
  it("rejects inserting a per-kg service without quote required", async () => {
    await expect(prisma.service.create({ data: newService("PER_KG", false) })).rejects.toThrow(
      /Service_per_kg_requires_quote/,
    );
  });

  it("rejects turning quote required off on a per-kg service", async () => {
    await expect(prisma.service.update({ where: { id: perKg.id }, data: { requiresQuote: false } })).rejects.toThrow(
      /Service_per_kg_requires_quote/,
    );
  });

  it("rejects switching a service without quote required to per kg", async () => {
    expect(perItem.requiresQuote).toBe(false);
    await expect(prisma.service.update({ where: { id: perItem.id }, data: { pricingType: "PER_KG" } })).rejects.toThrow(
      /Service_per_kg_requires_quote/,
    );
  });

  it("accepts per-kg with quote required, and other types either way", async () => {
    await insertThenRollBack(prisma, (tx) => tx.service.create({ data: newService("PER_KG", true) }));
    await insertThenRollBack(prisma, (tx) => tx.service.create({ data: newService("PER_ITEM", false) }));
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
