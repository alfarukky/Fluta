import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { createTestPrisma, insertThenRollBack } from "@/test/integration/db";

// The refund rules the database keeps itself (migration
// refund_method_reference_request_id). Every write here is refused or rolled
// back, so the seeded FreshFold order never changes.

let prisma: PrismaClient;
let storeId: string;
let orderId: string;
let userId: string;

beforeAll(async () => {
  prisma = createTestPrisma();
  const order = await prisma.order.findFirstOrThrow({
    where: { store: { slug: "freshfold-laundry" } },
    select: { id: true, storeId: true },
  });
  storeId = order.storeId;
  orderId = order.id;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: "ada@freshfold.example" }, select: { id: true } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const at = new Date("2026-10-28T10:00:00.000Z");

function refund(overrides: Partial<Prisma.RefundUncheckedCreateInput> = {}): Prisma.RefundUncheckedCreateInput {
  return {
    storeId,
    orderId,
    amount: 100_000,
    method: "BANK_TRANSFER",
    note: "Refunded by transfer",
    recordedByUserId: userId,
    clientRequestId: randomUUID(),
    paidAt: at,
    ...overrides,
  };
}

const voidDetails = { voidedAt: at, voidedByUserId: "owner", voidReason: "Wrong amount" };

describe("Refund CHECK constraints", () => {
  it.each([0, -100])("refuses an amount of %i", async (amount) => {
    await expect(prisma.refund.create({ data: refund({ amount }) })).rejects.toThrow(/Refund_amount_check/);
  });

  it("refuses the Paystack method", async () => {
    await expect(prisma.refund.create({ data: refund({ method: "PAYSTACK" }) })).rejects.toThrow(/Refund_method_check/);
  });

  it.each([
    ["void time", { voidedAt: null }],
    ["voiding owner", { voidedByUserId: null }],
    ["void reason", { voidReason: null }],
  ])("refuses a voided refund missing its %s", async (_, missing) => {
    await expect(prisma.refund.create({ data: refund({ ...voidDetails, ...missing }) })).rejects.toThrow(/Refund_voided_check/);
  });

  it("refuses a refund that isn't voided but has a void reason", async () => {
    await expect(prisma.refund.create({ data: refund({ voidReason: "Wrong amount" }) })).rejects.toThrow(/Refund_voided_check/);
  });

  it("accepts every store method, and a voided refund with every detail", async () => {
    await insertThenRollBack(prisma, async (tx) => {
      for (const method of ["CASH", "BANK_TRANSFER", "POS", "OTHER"] as const) {
        await tx.refund.create({ data: refund({ method }) });
      }
      await tx.refund.create({ data: refund(voidDetails) });
    });
  });
});

describe("Refund unique rules", () => {
  it("refuses a second replacement for the same voided refund", async () => {
    await expect(
      insertThenRollBack(prisma, async (tx) => {
        const voided = await tx.refund.create({ data: refund(voidDetails) });
        await tx.refund.create({ data: refund({ replacesRefundId: voided.id }) });
        await tx.refund.create({ data: refund({ replacesRefundId: voided.id }) });
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("refuses the same request ID twice in a store", async () => {
    await expect(
      insertThenRollBack(prisma, async (tx) => {
        await tx.refund.create({ data: refund({ clientRequestId: "same-request" }) });
        await tx.refund.create({ data: refund({ clientRequestId: "same-request" }) });
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
