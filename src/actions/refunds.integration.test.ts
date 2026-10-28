import { randomUUID } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TrackingOrder } from "@/components/tracking/TrackingOrder";
import type { OrderStage, PaymentMethod, PrismaClient } from "@/generated/prisma/client";
import { describeBalance } from "@/lib/payments";
import { generateToken, hashToken } from "@/lib/tokens";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { voidStoreRefund } from "@/server/data/refunds";
import { createUserWithPassword } from "@/server/data/users";
import { getOrderDetail } from "@/server/services/orders";
import { getRefundsPageData, recordRefund as recordRefundAsService, voidRefund as voidRefundAsService } from "@/server/services/refunds";
import { loadTrackingPage } from "@/server/services/tracking";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { recordRefund, voidRefund } from "./refunds";

// The actions read the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Each test builds orders and records refunds through several Neon round trips.
vi.setConfig({ testTimeout: 90_000 });

// Orders live in a throwaway store with its own owners, staff, and rider, so
// the seeded stores never change (CleanWave is only ever read).
const EMAIL_DOMAIN = "refunds-test.example";
const PASSWORD = "test-password-1234";
const NOTE = "Order cancelled, refunded by transfer";
const REFERENCE = "TRF-REF-5521";
const VOID_REASON = "Typed the wrong amount";

type Role = "owner" | "secondOwner" | "staff" | "rider";

let prisma: PrismaClient;
let store: { id: string; orderPrefix: string; timeZone: string };
let customerId: string;
let users: Record<Role, { id: string; headers: Headers }>;
let freshFoldOwner: Headers;
let cleanWaveOrderId: string;
let nextOrderNumber = 1;

beforeAll(async () => {
  prisma = createTestPrisma();
  const suffix = randomUUID().slice(0, 8);
  const created = await prisma.store.create({
    data: {
      name: "Refunds Test Laundry",
      slug: `refunds-test-${suffix}`,
      orderPrefix: "RT",
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: { name: "Refund Test Customer", phone: "+2348030000003" } },
    },
    select: { id: true, orderPrefix: true, timeZone: true, customers: { select: { id: true } } },
  });
  store = { id: created.id, orderPrefix: created.orderPrefix, timeZone: created.timeZone };
  customerId = created.customers[0].id;
  users = {
    owner: await addUser("owner", "OWNER"),
    secondOwner: await addUser("second-owner", "OWNER"),
    staff: await addUser("staff", "STAFF"),
    rider: await addUser("rider", "RIDER"),
  };
  freshFoldOwner = await signInHeaders("ada@freshfold.example");
  cleanWaveOrderId = (
    await prisma.order.findFirstOrThrow({ where: { store: { slug: "cleanwave-laundry" } }, select: { id: true } })
  ).id;
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, payments, refunds, or users.
  const where = { storeId: store.id };
  await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
  await prisma.refund.updateMany({ where, data: { replacesRefundId: null } });
  await prisma.$transaction(
    [
      prisma.auditEvent.deleteMany({ where }),
      prisma.messageEvent.deleteMany({ where }),
      prisma.statusEvent.deleteMany({ where }),
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
  // Includes any left by an earlier run that stopped before its cleanup.
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

interface OrderSpec {
  stage?: OrderStage;
  total?: number;
  // A confirmed store-collected payment of this much.
  paid?: number;
}

// An order at `stage` with an approved price, and a payment if asked. Returns
// its ID and tracking token.
async function makeOrder({ stage = "CANCELLED", total = 500_000, paid }: OrderSpec = {}): Promise<{ id: string; token: string }> {
  const token = generateToken();
  const now = new Date();
  const order = await prisma.order.create({
    data: {
      storeId: store.id,
      orderNumber: nextOrderNumber++,
      customerId,
      channel: "COUNTER",
      fulfilmentType: "DROP_OFF",
      stage,
      trackingTokenHash: hashToken(token),
      trackingTokenIssuedAt: now,
      completedAt: stage === "COMPLETED" ? now : null,
      cancelledAt: stage === "CANCELLED" ? now : null,
    },
    select: { id: true },
  });
  const revision = await prisma.quoteRevision.create({
    data: {
      storeId: store.id,
      orderId: order.id,
      version: 1,
      // One line, as the tracking page shows it.
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
      createdAt: now,
      approvedAt: now,
      approvedByActor: "STAFF",
    },
    select: { id: true },
  });
  await prisma.order.update({ where: { id: order.id }, data: { approvedQuoteId: revision.id } });
  if (paid) {
    await prisma.payment.create({
      data: {
        storeId: store.id,
        orderId: order.id,
        amount: paid,
        source: "STORE_COLLECTED",
        method: "CASH",
        status: "CONFIRMED",
        recordedByUserId: users.staff.id,
        confirmedAt: now,
      },
    });
  }
  return { id: order.id, token };
}

interface RecordOptions {
  as?: Headers;
  method?: PaymentMethod;
  requestId?: string;
  note?: string;
}

function record(orderId: string, amount: string, options: RecordOptions = {}) {
  request.headers = options.as ?? users.staff.headers;
  return recordRefund({
    orderId,
    clientRequestId: options.requestId ?? randomUUID(),
    amount,
    method: options.method ?? "BANK_TRANSFER",
    reference: REFERENCE,
    note: options.note ?? NOTE,
  });
}

interface Replacement {
  amount: string;
  requestId?: string;
}

function voidIt(refundId: string, reason: string, options: { as?: Headers; replace?: Replacement } = {}) {
  request.headers = options.as ?? users.owner.headers;
  const { replace } = options;
  if (!replace) return voidRefund({ mode: "VOID_ONLY", refundId, reason });
  return voidRefund({
    mode: "REPLACE",
    refundId,
    reason,
    clientRequestId: replace.requestId ?? randomUUID(),
    amount: replace.amount,
    method: "CASH",
    reference: "",
    note: "Corrected amount",
  });
}

async function balanceOf(orderId: string) {
  const detail = await getOrderDetail(store.id, orderId, "OWNER");
  if (!detail) throw new Error("The test order is missing");
  return detail.balance;
}

async function refundsOf(orderId: string) {
  return prisma.refund.findMany({ where: { storeId: store.id, orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

async function onlyRefund(orderId: string): Promise<string> {
  const refunds = await refundsOf(orderId);
  expect(refunds).toHaveLength(1);
  return refunds[0].id;
}

describe("recording a refund", () => {
  it("moves a cancelled paid order from Refund owed to Nothing due", async () => {
    const order = await makeOrder({ paid: 500_000 });
    expect(describeBalance(await balanceOf(order.id))).toEqual({ label: "Refund owed", value: "₦5,000" });

    expect(await record(order.id, "5,000")).toEqual({ ok: true, message: "Refund recorded" });
    expect(await balanceOf(order.id)).toMatchObject({ state: "NOTHING_DUE", balanceKobo: 0, paidRefundsKobo: 500_000 });

    const [refund] = await refundsOf(order.id);
    expect(refund).toMatchObject({
      amount: 500_000,
      method: "BANK_TRANSFER",
      reference: REFERENCE,
      note: NOTE,
      recordedByUserId: users.staff.id,
      voidedAt: null,
      replacesRefundId: null,
    });
    expect(refund.paidAt).toBeInstanceOf(Date);
  });

  it("leaves the rest owed after a part refund, then records the rest", async () => {
    const order = await makeOrder({ paid: 500_000 });
    expect(await record(order.id, "2,000")).toMatchObject({ ok: true });
    expect(await balanceOf(order.id)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -300_000 });
    expect(await record(order.id, "3,000")).toMatchObject({ ok: true });
    expect(await balanceOf(order.id)).toMatchObject({ state: "NOTHING_DUE" });
  });

  it("refunds an overpaid completed order, whatever its stage", async () => {
    // ₦10,000 total, ₦15,000 paid, ₦2,000 already refunded: ₦3,000 refundable.
    const order = await makeOrder({ stage: "COMPLETED", total: 1_000_000, paid: 1_500_000 });
    expect(await record(order.id, "2,000")).toMatchObject({ ok: true });
    expect(await record(order.id, "3,000.01")).toEqual({
      ok: false,
      code: "MORE_THAN_OWED",
      message: "The amount owed has changed. ₦3,000 is now owed.",
      owedKobo: 300_000,
    });
    expect(await record(order.id, "3,000")).toMatchObject({ ok: true });
    expect(await balanceOf(order.id)).toMatchObject({ state: "PAID", balanceKobo: 0 });
  });

  it("refuses when nothing is owed", async () => {
    const paid = await makeOrder({ stage: "READY", paid: 500_000 });
    const unpaid = await makeOrder({ stage: "CANCELLED" });
    for (const orderId of [paid.id, unpaid.id]) {
      expect(await record(orderId, "1,000")).toMatchObject({ ok: false, code: "NOTHING_OWED" });
      expect(await refundsOf(orderId)).toHaveLength(0);
    }
  });

  it("refuses a stale form: another refund was recorded while it was open", async () => {
    const order = await makeOrder({ paid: 500_000 });
    // Both forms opened when ₦5,000 was owed.
    expect(await record(order.id, "2,000", { as: users.owner.headers })).toMatchObject({ ok: true });
    expect(await record(order.id, "5,000")).toMatchObject({
      ok: false,
      code: "MORE_THAN_OWED",
      message: "The amount owed has changed. ₦3,000 is now owed.",
    });
    expect(await refundsOf(order.id)).toHaveLength(1);
  });

  it("requires a note and an amount above ₦0, with the messages under the fields", async () => {
    const order = await makeOrder({ paid: 500_000 });
    expect(await record(order.id, "1,000", { note: " " })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { note: "Add a note about this refund" },
    });
    expect(await record(order.id, "0")).toMatchObject({ ok: false, fieldErrors: { amount: "Enter an amount above ₦0" } });
    expect(await record(order.id, "1,000", { method: "PAYSTACK" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await refundsOf(order.id)).toHaveLength(0);
  });

  it("never changes a payment, and an online payment's fees never reduce what's owed", async () => {
    const order = await makeOrder({ stage: "CANCELLED" });
    const online = await prisma.payment.create({
      data: {
        storeId: store.id,
        orderId: order.id,
        amount: 500_000,
        source: "ONLINE",
        method: "PAYSTACK",
        status: "CONFIRMED",
        paystackReference: `test-${randomUUID()}`,
        confirmedAt: new Date(),
        flutaFeeBps: 150,
        flutaFeeAmount: 7_500,
        paystackFeeAmount: 7_500,
      },
    });
    // What the customer paid, not what the store received after fees.
    expect(await balanceOf(order.id)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -500_000 });
    expect(await record(order.id, "5,000")).toMatchObject({ ok: true });

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: online.id } });
    expect(after).toEqual(online);
    expect(await balanceOf(order.id)).toMatchObject({ state: "NOTHING_DUE" });
  });

  it("writes no status event", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "1,000");
    expect(await prisma.statusEvent.count({ where: { storeId: store.id, orderId: order.id } })).toBe(0);
    const detail = await getOrderDetail(store.id, order.id, "STAFF");
    expect(detail?.timeline.filter((entry) => entry.kind === "refund")).toMatchObject([{ moment: "RECORDED" }]);
  });

  it("refuses a rider", async () => {
    const order = await makeOrder({ paid: 500_000 });
    expect(await record(order.id, "1,000", { as: users.rider.headers })).toMatchObject({ ok: false, code: "NOT_ALLOWED_FOR_STORE" });
    expect(await refundsOf(order.id)).toHaveLength(0);
  });
});

describe("double submits and refunds at the same moment", () => {
  it("returns the same refund for the same request ID", async () => {
    const order = await makeOrder({ paid: 500_000 });
    const requestId = randomUUID();
    expect(await record(order.id, "1,000", { requestId })).toMatchObject({ ok: true });
    expect(await record(order.id, "1,000", { requestId })).toEqual({ ok: true, message: "Refund recorded" });
    expect(await refundsOf(order.id)).toHaveLength(1);
  });

  it("creates one refund when the same request arrives twice at the same moment", async () => {
    const order = await makeOrder({ paid: 500_000 });
    const input = {
      orderId: order.id,
      clientRequestId: randomUUID(),
      amount: 100_000,
      method: "CASH" as const,
      reference: null,
      note: NOTE,
    };
    const actor = { storeId: store.id, userId: users.staff.id };
    const results = await Promise.all([recordRefundAsService(actor, input, new Date()), recordRefundAsService(actor, input, new Date())]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(await refundsOf(order.id)).toHaveLength(1);
  });

  it("lets exactly one of two different full refunds at the same moment succeed", async () => {
    const order = await makeOrder({ paid: 500_000 });
    const refund = (userId: string) =>
      recordRefundAsService(
        { storeId: store.id, userId },
        { orderId: order.id, clientRequestId: randomUUID(), amount: 500_000, method: "CASH", reference: null, note: NOTE },
        new Date(),
      );
    const results = await Promise.all([refund(users.staff.id), refund(users.owner.id)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, code: "NOTHING_OWED" });
    expect(await refundsOf(order.id)).toHaveLength(1);
    expect(await balanceOf(order.id)).toMatchObject({ state: "NOTHING_DUE" });
  });

  it("refuses a request ID already used on another order", async () => {
    const [first, second] = [await makeOrder({ paid: 500_000 }), await makeOrder({ paid: 500_000 })];
    const requestId = randomUUID();
    await record(first.id, "1,000", { requestId });
    expect(await record(second.id, "1,000", { requestId })).toMatchObject({ ok: false, code: "REQUEST_REUSED" });
    expect(await refundsOf(second.id)).toHaveLength(0);
  });
});

describe("voiding a refund", () => {
  it("lets only owners void, with a reason, and the voided refund stops counting", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "5,000");
    const refundId = await onlyRefund(order.id);

    expect(await voidIt(refundId, VOID_REASON, { as: users.staff.headers })).toEqual({
      ok: false,
      code: "NOT_ALLOWED_FOR_STORE",
      message: "Only the store owner can void refunds.",
    });
    expect(await voidIt(refundId, VOID_REASON, { as: users.rider.headers })).toMatchObject({ ok: false });
    expect(await voidIt(refundId, "  ")).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { reason: "Add a reason for voiding this refund" },
    });
    expect((await refundsOf(order.id))[0].voidedAt).toBeNull();

    expect(await voidIt(refundId, VOID_REASON)).toEqual({ ok: true, message: "Refund voided" });
    const [voided] = await refundsOf(order.id);
    expect(voided).toMatchObject({ voidedByUserId: users.owner.id, voidReason: VOID_REASON, amount: 500_000 });
    expect(voided.voidedAt).toBeInstanceOf(Date);
    // Refund owed again.
    expect(await balanceOf(order.id)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -500_000, paidRefundsKobo: 0 });

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { storeId: store.id, targetId: refundId } });
    expect(audit).toMatchObject({
      action: "REFUND_VOIDED",
      targetType: "Refund",
      actorUserId: users.owner.id,
      reason: VOID_REASON,
      metadata: { orderId: order.id, amount: 500_000, method: "BANK_TRANSFER", replacementRefundId: null },
    });

    const detail = await getOrderDetail(store.id, order.id, "OWNER");
    expect(detail?.timeline.filter((entry) => entry.kind === "refund").map((entry) => entry.moment)).toEqual([
      "VOIDED",
      "RECORDED",
    ]);
  });

  it("leaves the right amount owed after a refund, its void, and a smaller new refund", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "5,000");
    await voidIt(await onlyRefund(order.id), VOID_REASON);
    expect(await record(order.id, "3,000")).toMatchObject({ ok: true });
    expect(await balanceOf(order.id)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -200_000, paidRefundsKobo: 300_000 });
  });

  it("voids and records the correct refund in one transaction, linked and audited, counting only the replacement", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "5,000");
    const originalId = await onlyRefund(order.id);

    expect(await voidIt(originalId, VOID_REASON, { replace: { amount: "3,000" } })).toEqual({
      ok: true,
      message: "Refund voided and correct refund recorded",
    });
    const [original, replacement] = await refundsOf(order.id);
    expect(original).toMatchObject({ id: originalId, voidReason: VOID_REASON });
    expect(replacement).toMatchObject({
      amount: 300_000,
      method: "CASH",
      replacesRefundId: originalId,
      recordedByUserId: users.owner.id,
      voidedAt: null,
    });
    expect(await balanceOf(order.id)).toMatchObject({ state: "REFUND_OWED", balanceKobo: -200_000, paidRefundsKobo: 300_000 });
    expect(await prisma.auditEvent.findFirstOrThrow({ where: { storeId: store.id, targetId: originalId } })).toMatchObject({
      action: "REFUND_CORRECTED",
      metadata: { replacementRefundId: replacement.id },
    });
  });

  it("refuses a replacement for more than is owed after the void, and keeps the original", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "5,000");
    const refundId = await onlyRefund(order.id);
    expect(await voidIt(refundId, VOID_REASON, { replace: { amount: "6,000" } })).toMatchObject({
      ok: false,
      code: "MORE_THAN_OWED",
      message: "The amount owed has changed. ₦5,000 is now owed.",
    });
    expect(await refundsOf(order.id)).toMatchObject([{ id: refundId, voidedAt: null }]);
  });

  it("returns the same replacement for a retried void and replace, and success for a retried void only", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "5,000");
    const refundId = await onlyRefund(order.id);
    const requestId = randomUUID();

    expect(await voidIt(refundId, VOID_REASON, { replace: { amount: "3,000", requestId } })).toMatchObject({ ok: true });
    expect(await voidIt(refundId, VOID_REASON, { replace: { amount: "3,000", requestId } })).toMatchObject({ ok: true });
    expect(await refundsOf(order.id)).toHaveLength(2);
    expect(await prisma.auditEvent.count({ where: { storeId: store.id, targetId: refundId } })).toBe(1);

    const other = await makeOrder({ paid: 500_000 });
    await record(other.id, "5,000");
    const otherId = await onlyRefund(other.id);
    expect(await voidIt(otherId, VOID_REASON)).toMatchObject({ ok: true });
    expect(await voidIt(otherId, VOID_REASON)).toEqual({ ok: true, message: "Refund voided" });
    // Someone else, or a replacement after the void, is refused.
    expect(await voidIt(otherId, VOID_REASON, { as: users.secondOwner.headers })).toMatchObject({ ok: false, code: "ALREADY_VOIDED" });
    expect(await voidIt(otherId, VOID_REASON, { replace: { amount: "1,000" } })).toMatchObject({ ok: false, code: "ALREADY_VOIDED" });
    expect(await prisma.auditEvent.count({ where: { storeId: store.id, targetId: otherId } })).toBe(1);
  });

  it("changes nothing when the replacement fails to save", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "5,000");
    const originalId = await onlyRefund(order.id);

    // A replacement the database refuses (the Paystack method), sent past the action's checks.
    await expect(
      voidStoreRefund(
        store.id,
        {
          refundId: originalId,
          actorUserId: users.owner.id,
          reason: VOID_REASON,
          replacement: {
            clientRequestId: randomUUID(),
            details: { amount: 300_000, method: "PAYSTACK", reference: null, note: "Corrected" },
          },
        },
        () => ({ kind: "void" }),
        new Date(),
      ),
    ).rejects.toThrow();

    expect(await refundsOf(order.id)).toMatchObject([{ id: originalId, voidedAt: null, voidedByUserId: null, voidReason: null }]);
    expect(await prisma.auditEvent.count({ where: { storeId: store.id, targetId: originalId } })).toBe(0);
    expect(await balanceOf(order.id)).toMatchObject({ state: "NOTHING_DUE" });
  });

  it("lets exactly one of two owners voiding at once succeed", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "5,000");
    const refundId = await onlyRefund(order.id);
    const input = { mode: "VOID_ONLY" as const, refundId, reason: VOID_REASON };

    const results = await Promise.all([
      voidRefundAsService({ storeId: store.id, userId: users.owner.id }, input, new Date()),
      voidRefundAsService({ storeId: store.id, userId: users.secondOwner.id }, input, new Date()),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: "ALREADY_VOIDED" });
    expect(await prisma.auditEvent.count({ where: { storeId: store.id, targetId: refundId } })).toBe(1);
  });
});

describe("store access", () => {
  it("refuses recording and voiding when the store can't work on existing orders", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "1,000");
    const refundId = await onlyRefund(order.id);

    await prisma.store.update({ where: { id: store.id }, data: { status: "DEACTIVATED" } });
    try {
      expect(await record(order.id, "1,000")).toMatchObject({ ok: false, code: "NOT_ALLOWED_FOR_STORE" });
      expect(await voidIt(refundId, VOID_REASON)).toMatchObject({ ok: false, code: "NOT_ALLOWED_FOR_STORE" });
    } finally {
      await prisma.store.update({ where: { id: store.id }, data: { status: "ACTIVE" } });
    }
    expect(await refundsOf(order.id)).toMatchObject([{ id: refundId, voidedAt: null }]);
  });

  it("won't let a FreshFold owner record on a CleanWave order or void another store's refund, even by sending its ID", async () => {
    const before = await prisma.refund.count({ where: { orderId: cleanWaveOrderId } });
    expect(await record(cleanWaveOrderId, "1,000", { as: freshFoldOwner })).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Order not found.",
    });
    expect(await prisma.refund.count({ where: { orderId: cleanWaveOrderId } })).toBe(before);

    // A refund outside FreshFold (this test store's).
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "1,000");
    const refundId = await onlyRefund(order.id);
    expect(await voidIt(refundId, "Not ours", { as: freshFoldOwner })).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Refund not found.",
    });
    expect(await voidIt(refundId, "Not ours", { as: freshFoldOwner, replace: { amount: "1,000" } })).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await refundsOf(order.id)).toMatchObject([{ id: refundId, voidedAt: null }]);
  });
});

describe("the customer's tracking page", () => {
  it("shows Refunded: ₦X, the total of active refunds, and never notes, references, or void reasons", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "2,000");
    await record(order.id, "1,000");
    const voided = (await refundsOf(order.id))[1].id;
    await voidIt(voided, VOID_REASON);

    const page = await loadTrackingPage(order.token);
    if (page.kind !== "VALID") throw new Error("The link should work while a refund is owed");
    expect(page.view).toMatchObject({ payment: "The store will refund ₦3,000", refunded: "Refunded: ₦2,000" });

    const html = renderToStaticMarkup(TrackingOrder({ view: page.view, basePath: "/o/test", token: order.token }));
    expect(html).toContain("Refunded: ₦2,000");
    for (const text of [JSON.stringify(page.view), html]) {
      for (const secret of [NOTE, REFERENCE, VOID_REASON]) expect(text).not.toContain(secret);
    }

    await record(order.id, "3,000");
    expect(await loadTrackingPage(order.token)).toMatchObject({
      kind: "VALID",
      view: { payment: "Nothing due", refunded: "Refunded: ₦5,000" },
    });
  });
});

describe("the Payments page's Refunds view", () => {
  it("lists refunds for staff without a total, and gives owners a total without voided refunds", async () => {
    const order = await makeOrder({ paid: 500_000 });
    await record(order.id, "2,000");
    await record(order.id, "1,000");
    const voidedId = (await refundsOf(order.id))[1].id;
    await voidIt(voidedId, VOID_REASON);

    const staff = await getRefundsPageData(store, "STAFF", "today", new Date());
    expect(staff.totalKobo).toBeNull();
    expect(staff.page.rows.find((row) => row.id === voidedId)).toMatchObject({ voided: true, amount: "₦1,000" });
    expect(JSON.stringify(staff.page)).not.toContain(VOID_REASON);
    expect(JSON.stringify(staff.page)).not.toContain(NOTE);

    const owner = await getRefundsPageData(store, "OWNER", "today", new Date());
    const active = await prisma.refund.aggregate({ where: { storeId: store.id, voidedAt: null }, _sum: { amount: true } });
    expect(owner.totalKobo).toBe(active._sum.amount);
    // Newest first.
    const paid = (await prisma.refund.findMany({ where: { storeId: store.id }, orderBy: [{ paidAt: "desc" }, { id: "desc" }] })).map(
      (refund) => refund.id,
    );
    expect(owner.page.rows.map((row) => row.id)).toEqual(paid.slice(0, owner.page.rows.length));
  });
});
