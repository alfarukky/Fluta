import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { createTestPrisma, insertThenRollBack } from "@/test/integration/db";

// The payment rules the database keeps itself (migration
// store_collected_payments). Every write here is refused or rolled back, so
// the seeded FreshFold order never changes.

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

const at = new Date("2026-10-20T10:00:00.000Z");

function payment(overrides: Partial<Prisma.PaymentUncheckedCreateInput> = {}): Prisma.PaymentUncheckedCreateInput {
  return {
    storeId,
    orderId,
    amount: 100_000,
    source: "STORE_COLLECTED",
    method: "CASH",
    status: "CONFIRMED",
    recordedByUserId: userId,
    confirmedAt: at,
    ...overrides,
  };
}

const voidDetails = { voidedAt: at, voidedByUserId: "owner", voidReason: "Entered twice" };

describe("Payment state CHECK constraints", () => {
  it("refuses a confirmed payment without its confirmation time", async () => {
    await expect(prisma.payment.create({ data: payment({ confirmedAt: null }) })).rejects.toThrow(/Payment_confirmed_check/);
  });

  it.each([
    ["all the void details", voidDetails],
    ["a void time", { voidedAt: at }],
    ["a voiding owner", { voidedByUserId: "owner" }],
    ["a void reason", { voidReason: "Entered twice" }],
  ])("refuses a confirmed payment with %s", async (_, details) => {
    await expect(prisma.payment.create({ data: payment(details) })).rejects.toThrow(/Payment_confirmed_check/);
  });

  it.each([
    ["void time", { voidedAt: null }],
    ["voiding owner", { voidedByUserId: null }],
    ["void reason", { voidReason: null }],
    ["confirmation time", { confirmedAt: null }],
  ])("refuses a voided payment missing its %s", async (_, missing) => {
    await expect(prisma.payment.create({ data: payment({ status: "VOIDED", ...voidDetails, ...missing }) })).rejects.toThrow(
      /Payment_voided_check/,
    );
  });

  it("refuses voiding through an update that leaves out the details", async () => {
    await expect(
      insertThenRollBack(prisma, async (tx) => {
        const { id } = await tx.payment.create({ data: payment() });
        await tx.payment.update({ where: { id }, data: { status: "VOIDED" } });
      }),
    ).rejects.toThrow(/Payment_voided_check/);
  });

  it("accepts a confirmed payment, and a voided one with every detail", async () => {
    await insertThenRollBack(prisma, (tx) => tx.payment.create({ data: payment() }));
    await insertThenRollBack(prisma, (tx) => tx.payment.create({ data: payment({ status: "VOIDED", ...voidDetails }) }));
  });
});

describe("Payment method CHECK constraint", () => {
  it("refuses a store-collected payment with the Paystack method", async () => {
    await expect(prisma.payment.create({ data: payment({ method: "PAYSTACK" }) })).rejects.toThrow(
      /Payment_store_collected_method_check/,
    );
  });

  it("accepts every store method, and Paystack online", async () => {
    await insertThenRollBack(prisma, async (tx) => {
      for (const method of ["CASH", "BANK_TRANSFER", "POS", "OTHER"] as const) {
        await tx.payment.create({ data: payment({ method }) });
      }
      await tx.payment.create({
        data: payment({ source: "ONLINE", method: "PAYSTACK", recordedByUserId: null, paystackReference: "constraint-check" }),
      });
    });
  });
});

describe("Payment unique rules", () => {
  it("refuses a second replacement for the same voided payment", async () => {
    await expect(
      insertThenRollBack(prisma, async (tx) => {
        const voided = await tx.payment.create({ data: payment({ status: "VOIDED", ...voidDetails }) });
        await tx.payment.create({ data: payment({ replacesPaymentId: voided.id }) });
        await tx.payment.create({ data: payment({ replacesPaymentId: voided.id }) });
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("refuses the same request ID twice in a store", async () => {
    await expect(
      insertThenRollBack(prisma, async (tx) => {
        await tx.payment.create({ data: payment({ clientRequestId: "same-request" }) });
        await tx.payment.create({ data: payment({ clientRequestId: "same-request" }) });
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
