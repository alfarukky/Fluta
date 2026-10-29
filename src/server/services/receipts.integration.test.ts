import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { OrderStage, PaymentStatus, PrismaClient } from "@/generated/prisma/client";
import { RECEIPT_TEXT, describeReceiptBalance } from "@/lib/receipts";
import { generateToken, hashToken } from "@/lib/tokens";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";
import { getOrderDetail } from "@/server/services/orders";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { getReceiptData } from "./receipts";

// getReceiptData reads the session from next/headers; here it's the headers
// of whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

vi.setConfig({ testTimeout: 90_000 });

// Orders live in a throwaway store with its own owner, staff, and rider, so
// the seeded stores never change (CleanWave is only ever read).
const EMAIL_DOMAIN = "receipts-test.example";
const PASSWORD = "test-password-1234";

type Role = "owner" | "staff" | "rider";

let prisma: PrismaClient;
let store: { id: string };
let customerId: string;
let users: Record<Role, { id: string; headers: Headers }>;
let freshFoldOwner: Headers;
let cleanWavePaidOrderId: string;
let nextOrderNumber = 1;

beforeAll(async () => {
  prisma = createTestPrisma();
  const suffix = randomUUID().slice(0, 8);
  const created = await prisma.store.create({
    data: {
      name: "Receipts Test Laundry",
      slug: `receipts-test-${suffix}`,
      orderPrefix: "RC",
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: { name: "Receipt Test Customer", phone: "+2348030000004" } },
    },
    select: { id: true, customers: { select: { id: true } } },
  });
  store = { id: created.id };
  customerId = created.customers[0].id;
  users = {
    owner: await addUser("owner", "OWNER"),
    staff: await addUser("staff", "STAFF"),
    rider: await addUser("rider", "RIDER"),
  };
  freshFoldOwner = await signInHeaders("ada@freshfold.example");
  // A CleanWave order that does have a receipt, so a refusal can't be
  // explained by a missing payment.
  cleanWavePaidOrderId = (
    await prisma.order.findFirstOrThrow({
      where: { store: { slug: "cleanwave-laundry" }, payments: { some: { status: "CONFIRMED", voidedAt: null } } },
      select: { id: true },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, payments, refunds, or users.
  const where = { storeId: store.id };
  await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
  await prisma.$transaction(
    [
      prisma.refund.deleteMany({ where }),
      prisma.payment.deleteMany({ where }),
      prisma.quoteRevision.deleteMany({ where }),
      prisma.notification.deleteMany({ where }),
      prisma.order.deleteMany({ where }),
      prisma.customer.deleteMany({ where }),
      prisma.subscription.deleteMany({ where }),
      prisma.membership.deleteMany({ where }),
    ],
    { maxWait: 15_000, timeout: 30_000 },
  );
  const userIds = (
    await prisma.user.findMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } }, select: { id: true } })
  ).map((user) => user.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function addUser(label: string, role: "OWNER" | "STAFF" | "RIDER"): Promise<{ id: string; headers: Headers }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const { id } = await createUserWithPassword({ name: `Test ${label}`, email, password: PASSWORD }, prisma);
  const result = await createMembership(store.id, { userId: id, role }, prisma);
  if (!result.success) throw new Error(`Couldn't add ${email} to the test store`);
  return { id, headers: await signInHeaders(email, PASSWORD) };
}

interface PaymentSpec {
  amount: number;
  status?: PaymentStatus;
  voided?: boolean;
}

// An order at `stage` with an approved price of `total`, its payments, and
// any refunds.
async function makeOrder(stage: OrderStage, total: number, payments: PaymentSpec[], refunds: number[] = []): Promise<string> {
  const now = new Date();
  const { id } = await prisma.order.create({
    data: {
      storeId: store.id,
      orderNumber: nextOrderNumber++,
      customerId,
      channel: "COUNTER",
      fulfilmentType: "DROP_OFF",
      stage,
      trackingTokenHash: hashToken(generateToken()),
      trackingTokenIssuedAt: now,
      completedAt: stage === "COMPLETED" ? now : null,
      cancelledAt: stage === "CANCELLED" ? now : null,
    },
    select: { id: true },
  });
  const revision = await prisma.quoteRevision.create({
    data: {
      storeId: store.id,
      orderId: id,
      version: 1,
      linesSnapshot: {
        lines: [
          {
            lineType: "SERVICE",
            serviceId: null,
            description: "Wash & fold",
            pricingType: "PER_ITEM",
            requiresQuote: false,
            unitPrice: total,
            quantity: "1",
            quantityIsEstimate: false,
            lineTotal: total,
          },
        ],
        areaName: null,
        isOutOfArea: false,
        fulfilmentCharge: null,
      },
      itemsSubtotal: total,
      total,
      status: "APPROVED",
      createdByActor: "STAFF",
      createdByUserId: users.staff.id,
      approvedAt: now,
      approvedByActor: "STAFF",
    },
    select: { id: true },
  });
  await prisma.order.update({ where: { id }, data: { approvedQuoteId: revision.id } });
  for (const { amount, status = "CONFIRMED", voided = false } of payments) {
    const online = status !== "CONFIRMED";
    await prisma.payment.create({
      data: {
        storeId: store.id,
        orderId: id,
        amount,
        source: online ? "ONLINE" : "STORE_COLLECTED",
        method: online ? "PAYSTACK" : "CASH",
        status: voided ? "VOIDED" : status,
        paystackReference: online ? `rc-${randomUUID()}` : null,
        recordedByUserId: online ? null : users.staff.id,
        confirmedAt: online ? null : now,
        voidedAt: voided ? now : null,
        voidedByUserId: voided ? users.owner.id : null,
        voidReason: voided ? "Recorded on the wrong order" : null,
      },
    });
  }
  for (const amount of refunds) {
    await prisma.refund.create({
      data: {
        storeId: store.id,
        orderId: id,
        amount,
        method: "CASH",
        note: "Refunded at the counter",
        recordedByUserId: users.staff.id,
        clientRequestId: randomUUID(),
        paidAt: now,
      },
    });
  }
  return id;
}

function as(role: Role | Headers): void {
  request.headers = role instanceof Headers ? role : users[role].headers;
}

describe("who can open a receipt", () => {
  it("lets owners and staff open it", async () => {
    const id = await makeOrder("READY", 500_000, [{ amount: 200_000 }]);
    for (const role of ["owner", "staff"] as const) {
      as(role);
      const result = await getReceiptData(id);
      expect(result.kind).toBe("RECEIPT");
    }
  });

  it("refuses riders itself", async () => {
    const id = await makeOrder("READY", 500_000, [{ amount: 200_000 }]);
    as("rider");
    expect(await getReceiptData(id)).toEqual({ kind: "DENIED", reason: "ROLE_NOT_PERMITTED" });
  });

  it("never opens another store's receipt, even by its ID", async () => {
    as(freshFoldOwner);
    expect(await getReceiptData(cleanWavePaidOrderId)).toEqual({ kind: "NOT_FOUND" });
    as("owner");
    expect(await getReceiptData(cleanWavePaidOrderId)).toEqual({ kind: "NOT_FOUND" });
  });
});

describe("when a receipt is available", () => {
  it("shows the message once the only payment is voided", async () => {
    const id = await makeOrder("READY", 500_000, [{ amount: 500_000 }]);
    as("staff");
    expect((await getReceiptData(id)).kind).toBe("RECEIPT");

    await prisma.payment.updateMany({
      where: { storeId: store.id, orderId: id },
      data: { status: "VOIDED", voidedAt: new Date(), voidedByUserId: users.owner.id, voidReason: "Wrong order" },
    });
    const result = await getReceiptData(id);
    expect(result).toEqual({ kind: "NO_PAYMENT", orderNumber: expect.stringMatching(/^Order number: RC-\d+$/), message: RECEIPT_TEXT.noPayment });
  });

  it("has none for a pending online attempt or refunds alone", async () => {
    as("owner");
    const pending = await makeOrder("READY", 500_000, [{ amount: 500_000, status: "PENDING" }]);
    expect((await getReceiptData(pending)).kind).toBe("NO_PAYMENT");
    const refundsOnly = await makeOrder("CANCELLED", 500_000, [{ amount: 100_000, voided: true }], [50_000]);
    expect((await getReceiptData(refundsOnly)).kind).toBe("NO_PAYMENT");
  });

  it("tells the order page to offer Print receipt only when there is one", async () => {
    const paid = await makeOrder("READY", 500_000, [{ amount: 100_000 }]);
    const unpaid = await makeOrder("READY", 500_000, [{ amount: 100_000, voided: true }]);
    expect((await getOrderDetail(store.id, paid, "STAFF"))?.hasReceipt).toBe(true);
    expect((await getOrderDetail(store.id, unpaid, "STAFF"))?.hasReceipt).toBe(false);
  });
});

describe("the receipt's balance", () => {
  it("always matches the order page's", async () => {
    as("staff");
    const orders = await Promise.all([
      makeOrder("READY", 500_000, [{ amount: 500_000 }]),
      makeOrder("IN_PROGRESS", 500_000, [{ amount: 200_000 }, { amount: 900_000, voided: true }]),
      makeOrder("COMPLETED", 500_000, [{ amount: 700_000 }]),
      makeOrder("CANCELLED", 500_000, [{ amount: 300_000 }]),
      makeOrder("CANCELLED", 500_000, [{ amount: 300_000 }], [300_000]),
      makeOrder("READY", 500_000, [{ amount: 100_000 }, { amount: 400_000, status: "PENDING" }]),
    ]);
    const balances = [];
    for (const id of orders) {
      const result = await getReceiptData(id);
      if (result.kind !== "RECEIPT") throw new Error(`Expected a receipt for ${id}`);
      const detail = await getOrderDetail(store.id, id, "STAFF");
      expect(result.receipt.balance).toBe(describeReceiptBalance(detail!.balance));
      balances.push(result.receipt.balance);
    }
    expect(balances).toEqual([
      "Fully paid",
      "Amount still to pay: ₦3,000",
      "Amount to be refunded to you: ₦2,000",
      "Amount to be refunded to you: ₦3,000",
      "Nothing to pay",
      "Amount still to pay: ₦4,000",
    ]);
  });
});
