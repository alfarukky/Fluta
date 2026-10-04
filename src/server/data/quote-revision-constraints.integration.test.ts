import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { createTestPrisma, insertThenRollBack } from "@/test/integration/db";

let prisma: PrismaClient;
let order: { storeId: string; orderId: string };
let ownerId: string;

beforeAll(async () => {
  prisma = createTestPrisma();
  const store = await prisma.store.findUniqueOrThrow({
    where: { slug: "freshfold-laundry" },
    include: { orders: { take: 1 }, memberships: { where: { role: "OWNER" } } },
  });
  order = { storeId: store.id, orderId: store.orders[0].id };
  ownerId = store.memberships[0].userId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("QuoteRevision creator CHECK constraint", () => {
  const revision = () => ({
    ...order,
    // Far above any seeded version, so it never clashes with @@unique([orderId, version]).
    version: 999,
    linesSnapshot: [],
    itemsSubtotal: 0,
    total: 0,
  });

  it("rejects a STAFF revision without createdByUserId", async () => {
    await expect(
      prisma.quoteRevision.create({ data: { ...revision(), createdByActor: "STAFF", createdByUserId: null } }),
    ).rejects.toThrow(/QuoteRevision_creator_check/);
  });

  it("rejects a CUSTOMER revision with a createdByUserId", async () => {
    await expect(
      prisma.quoteRevision.create({ data: { ...revision(), createdByActor: "CUSTOMER", createdByUserId: ownerId } }),
    ).rejects.toThrow(/QuoteRevision_creator_check/);
  });

  it("rejects any other actor", async () => {
    for (const createdByActor of ["SYSTEM", "FLUTA_ADMIN"] as const) {
      await expect(
        prisma.quoteRevision.create({ data: { ...revision(), createdByActor, createdByUserId: ownerId } }),
      ).rejects.toThrow(/QuoteRevision_creator_check/);
    }
  });

  it("accepts a staff revision with its creator and a customer revision without one", async () => {
    await insertThenRollBack(prisma, (tx) =>
      tx.quoteRevision.create({ data: { ...revision(), createdByActor: "STAFF", createdByUserId: ownerId } }),
    );
    await insertThenRollBack(prisma, (tx) =>
      tx.quoteRevision.create({ data: { ...revision(), createdByActor: "CUSTOMER", createdByUserId: null } }),
    );
  });
});
