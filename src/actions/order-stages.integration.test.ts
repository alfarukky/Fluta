import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { FulfilmentType, OrderStage, PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";
import { getOrderDetail } from "@/server/services/orders";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { changeOrderStage } from "./order-stages";

// The action reads the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Each test builds orders and moves them through several Neon round trips.
vi.setConfig({ testTimeout: 90_000 });

// Orders live in a throwaway store with its own owner and staff, so the
// seeded stores never change.
const EMAIL_DOMAIN = "order-stages-test.example";
const PASSWORD = "test-password-1234";
const CHANGED_MESSAGE = "This order was just updated. Refresh to see the latest.";

let prisma: PrismaClient;
let storeId: string;
let customerId: string;
let users: Record<"owner" | "staff", { id: string; headers: Headers }>;
let freshFoldStaff: Headers;
let cleanWaveOrder: { id: string; stage: OrderStage };
let nextOrderNumber = 1;

beforeAll(async () => {
  prisma = createTestPrisma();
  const suffix = randomUUID().slice(0, 8);
  const store = await prisma.store.create({
    data: {
      name: "Order Stages Test Laundry",
      slug: `order-stages-test-${suffix}`,
      orderPrefix: "OS",
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: { name: "Stage Test Customer", phone: "+2348030000001" } },
    },
    select: { id: true, customers: { select: { id: true } } },
  });
  storeId = store.id;
  customerId = store.customers[0].id;
  users = { owner: await addUser("owner", "OWNER"), staff: await addUser("staff", "STAFF") };
  freshFoldStaff = await signInHeaders("kemi@freshfold.example");

  const cleanWave = await prisma.store.findUniqueOrThrow({
    where: { slug: "cleanwave-laundry" },
    select: { orders: { where: { stage: { notIn: ["COMPLETED", "CANCELLED"] } }, take: 1, select: { id: true, stage: true } } },
  });
  cleanWaveOrder = cleanWave.orders[0];
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, customers, or users.
  const where = { storeId };
  await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
  await prisma.$transaction(
    [
      prisma.auditEvent.deleteMany({ where }),
      prisma.messageEvent.deleteMany({ where }),
      prisma.statusEvent.deleteMany({ where }),
      prisma.payment.deleteMany({ where }),
      prisma.quoteRevision.deleteMany({ where }),
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
  await prisma.store.delete({ where: { id: storeId } });
  await prisma.$disconnect();
  await getPrisma().$disconnect();
}, 120_000);

async function addUser(label: string, role: "OWNER" | "STAFF"): Promise<{ id: string; headers: Headers }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
  const { id } = await createUserWithPassword({ name: `Test ${label}`, email, password: PASSWORD }, prisma);
  const result = await createMembership(storeId, { userId: id, role }, prisma);
  if (!result.success) throw new Error(`Couldn't add ${email} to the test store`);
  return { id, headers: await signInHeaders(email, PASSWORD) };
}

interface OrderSpec {
  fulfilmentType?: FulfilmentType;
  // Every stage the order has been through, first to current.
  path: OrderStage[];
  approved?: boolean;
  revisionAwaitingApproval?: boolean;
  paid?: number;
}

// An order exactly as earlier moves would have left it: its stage, timeline,
// quote, and any payment. Written straight to the database.
async function makeOrder(spec: OrderSpec): Promise<string> {
  const fulfilmentType = spec.fulfilmentType ?? "DROP_OFF";
  const stage = spec.path.at(-1) ?? "BOOKED";
  const start = Date.UTC(2026, 0, 1, 9);
  const at = (index: number) => new Date(start + index * 60_000);
  const approved = spec.approved ?? true;

  const order = await prisma.order.create({
    data: {
      storeId,
      orderNumber: nextOrderNumber++,
      customerId,
      channel: "COUNTER",
      fulfilmentType,
      stage,
      stageBeforeQuote: stage === "QUOTE_AWAITING_APPROVAL" ? "RECEIVED_BY_STORE" : null,
      pickupWindowStatus: fulfilmentType === "PICKUP_DELIVERY" ? "CONFIRMED" : null,
      trackingTokenHash: randomUUID(),
      trackingTokenIssuedAt: at(0),
      completedAt: stage === "COMPLETED" ? at(spec.path.length) : null,
      createdAt: at(0),
    },
    select: { id: true },
  });
  const revision = (version: number, status: "APPROVED" | "PENDING") => ({
    storeId,
    orderId: order.id,
    version,
    linesSnapshot: [],
    itemsSubtotal: 500_000,
    total: 500_000,
    status,
    createdByActor: "STAFF" as const,
    createdByUserId: users.staff.id,
    approvedAt: status === "APPROVED" ? at(0) : null,
    approvedByActor: status === "APPROVED" ? ("STAFF" as const) : null,
  });
  const v1 = await prisma.quoteRevision.create({ data: revision(1, approved ? "APPROVED" : "PENDING"), select: { id: true } });
  if (approved) await prisma.order.update({ where: { id: order.id }, data: { approvedQuoteId: v1.id } });
  if (spec.revisionAwaitingApproval) await prisma.quoteRevision.create({ data: revision(2, "PENDING") });

  await prisma.statusEvent.createMany({
    data: spec.path.map((toStage, index) => ({
      storeId,
      orderId: order.id,
      fromStage: index === 0 ? null : spec.path[index - 1],
      toStage,
      actorType: "STAFF" as const,
      actorUserId: users.staff.id,
      createdAt: at(index + 1),
    })),
  });
  if (spec.paid) {
    await prisma.payment.create({
      data: {
        storeId,
        orderId: order.id,
        amount: spec.paid,
        source: "STORE_COLLECTED",
        method: "CASH",
        status: "CONFIRMED",
        recordedByUserId: users.staff.id,
        confirmedAt: at(1),
      },
    });
  }
  return order.id;
}

interface MoveOptions {
  as?: Headers;
  note?: string | null;
  collectedByCustomer?: boolean;
}

function move(orderId: string, from: OrderStage, to: OrderStage, options: MoveOptions = {}) {
  request.headers = options.as ?? users.staff.headers;
  return changeOrderStage({
    orderId,
    from,
    to,
    collectedByCustomer: options.collectedByCustomer ?? false,
    note: options.note ?? null,
  });
}

async function readOrder(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      stage: true,
      completedAt: true,
      cancelledAt: true,
      cancelNote: true,
      statusEvents: {
        select: { fromStage: true, toStage: true, actorType: true, actorUserId: true, note: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

const DROP_OFF_PATH: OrderStage[] = ["BOOKED", "RECEIVED_BY_STORE", "IN_PROGRESS", "READY"];
const PICKUP_PATH: OrderStage[] = [
  "BOOKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "RECEIVED_BY_STORE",
  "IN_PROGRESS",
  "READY",
  "OUT_FOR_DELIVERY",
];
const upTo = (path: OrderStage[], stage: OrderStage) => path.slice(0, path.indexOf(stage) + 1);

interface MoveCase {
  name: string;
  fulfilmentType: FulfilmentType;
  path: OrderStage[];
  to: OrderStage;
  note?: string;
  collectedByCustomer?: boolean;
  owner?: boolean;
}

const NOTE = "Checked with the customer";

// Every move this feature offers, by staff unless the move is owners only.
const ALLOWED_MOVES: MoveCase[] = [
  { name: "drop-off: Booked → Received", fulfilmentType: "DROP_OFF", path: ["BOOKED"], to: "RECEIVED_BY_STORE" },
  { name: "Received → In progress", fulfilmentType: "DROP_OFF", path: upTo(DROP_OFF_PATH, "RECEIVED_BY_STORE"), to: "IN_PROGRESS" },
  { name: "In progress → Ready", fulfilmentType: "DROP_OFF", path: upTo(DROP_OFF_PATH, "IN_PROGRESS"), to: "READY" },
  { name: "drop-off: Ready → Completed", fulfilmentType: "DROP_OFF", path: DROP_OFF_PATH, to: "COMPLETED" },
  { name: "pickup: Pickup scheduled → Picked up", fulfilmentType: "PICKUP_DELIVERY", path: upTo(PICKUP_PATH, "PICKUP_SCHEDULED"), to: "PICKED_UP" },
  { name: "pickup: Picked up → Received", fulfilmentType: "PICKUP_DELIVERY", path: upTo(PICKUP_PATH, "PICKED_UP"), to: "RECEIVED_BY_STORE" },
  { name: "pickup: Ready → Out for delivery", fulfilmentType: "PICKUP_DELIVERY", path: upTo(PICKUP_PATH, "READY"), to: "OUT_FOR_DELIVERY" },
  { name: "pickup: Out for delivery → Completed", fulfilmentType: "PICKUP_DELIVERY", path: PICKUP_PATH, to: "COMPLETED" },
  { name: "pickup: customer collected instead", fulfilmentType: "PICKUP_DELIVERY", path: upTo(PICKUP_PATH, "READY"), to: "COMPLETED", note: NOTE, collectedByCustomer: true },
  { name: "step back: drop-off Received → Booked", fulfilmentType: "DROP_OFF", path: upTo(DROP_OFF_PATH, "RECEIVED_BY_STORE"), to: "BOOKED", note: NOTE },
  { name: "step back: In progress → Received", fulfilmentType: "DROP_OFF", path: upTo(DROP_OFF_PATH, "IN_PROGRESS"), to: "RECEIVED_BY_STORE", note: NOTE },
  { name: "step back: Ready → In progress", fulfilmentType: "DROP_OFF", path: DROP_OFF_PATH, to: "IN_PROGRESS", note: NOTE },
  { name: "step back: Pickup scheduled → Booked", fulfilmentType: "PICKUP_DELIVERY", path: upTo(PICKUP_PATH, "PICKUP_SCHEDULED"), to: "BOOKED", note: NOTE },
  { name: "step back: Picked up → Pickup scheduled", fulfilmentType: "PICKUP_DELIVERY", path: upTo(PICKUP_PATH, "PICKED_UP"), to: "PICKUP_SCHEDULED", note: NOTE },
  { name: "step back: pickup Received → Picked up", fulfilmentType: "PICKUP_DELIVERY", path: upTo(PICKUP_PATH, "RECEIVED_BY_STORE"), to: "PICKED_UP", note: NOTE },
  { name: "step back: Out for delivery → Ready", fulfilmentType: "PICKUP_DELIVERY", path: PICKUP_PATH, to: "READY", note: NOTE },
  { name: "staff cancel with a note", fulfilmentType: "DROP_OFF", path: upTo(DROP_OFF_PATH, "IN_PROGRESS"), to: "CANCELLED", note: NOTE },
  { name: "owner cancel without a note", fulfilmentType: "PICKUP_DELIVERY", path: upTo(PICKUP_PATH, "PICKED_UP"), to: "CANCELLED", owner: true },
  { name: "owner reopen", fulfilmentType: "DROP_OFF", path: [...DROP_OFF_PATH, "COMPLETED"], to: "READY", note: NOTE, owner: true },
];

describe("every allowed move", () => {
  it.each(ALLOWED_MOVES)("$name", async (testCase) => {
    const orderId = await makeOrder({ fulfilmentType: testCase.fulfilmentType, path: testCase.path });
    const from = testCase.path.at(-1)!;
    const actor = testCase.owner ? users.owner : users.staff;

    const result = await move(orderId, from, testCase.to, {
      as: actor.headers,
      note: testCase.note,
      collectedByCustomer: testCase.collectedByCustomer,
    });
    expect(result).toMatchObject({ ok: true });

    const order = await readOrder(orderId);
    expect(order.stage).toBe(testCase.to);
    expect(order.statusEvents).toHaveLength(testCase.path.length + 1);
    expect(order.statusEvents.at(-1)).toEqual({
      fromStage: from,
      toStage: testCase.to,
      actorType: "STAFF",
      actorUserId: actor.id,
      note: testCase.note ?? null,
    });
    expect(order.completedAt === null).toBe(testCase.to !== "COMPLETED");
    expect(order.cancelledAt === null).toBe(testCase.to !== "CANCELLED");
    expect(order.cancelNote).toBe(testCase.to === "CANCELLED" ? (testCase.note ?? null) : null);
  });
});

describe("refused moves", () => {
  it("won't let staff reopen a completed order, even calling the action directly", async () => {
    const orderId = await makeOrder({ path: [...DROP_OFF_PATH, "COMPLETED"] });
    const result = await move(orderId, "COMPLETED", "READY", { note: NOTE });
    expect(result).toMatchObject({ ok: false, code: "NOT_OFFERED", message: "Only the owner can reopen a completed order." });
    const order = await readOrder(orderId);
    expect(order.stage).toBe("COMPLETED");
    expect(order.completedAt).not.toBeNull();
    expect(order.statusEvents).toHaveLength(5);
  });

  it("refuses a move this feature doesn't own (Booked → Pickup scheduled)", async () => {
    // canTransition allows it (the window is confirmed), but it belongs to online bookings.
    const orderId = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["BOOKED"] });
    const result = await move(orderId, "BOOKED", "PICKUP_SCHEDULED");
    expect(result).toMatchObject({ ok: false, code: "NOT_OFFERED" });
    expect((await readOrder(orderId)).stage).toBe("BOOKED");
  });

  it("requires a note where the rules say so", async () => {
    const orderId = await makeOrder({ path: upTo(DROP_OFF_PATH, "IN_PROGRESS") });
    expect(await move(orderId, "IN_PROGRESS", "CANCELLED")).toMatchObject({ ok: false, code: "NOTE_REQUIRED" });
    expect(await move(orderId, "IN_PROGRESS", "RECEIVED_BY_STORE", { note: "   " })).toMatchObject({
      ok: false,
      code: "NOTE_REQUIRED",
    });
    expect((await readOrder(orderId)).statusEvents).toHaveLength(3);
  });

  it("won't start work on an unpriced order, and says why", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE"], approved: false });
    const detail = await getOrderDetail(storeId, orderId, "STAFF");
    expect(detail?.stageMoves).toMatchObject({ primary: null, blockedReason: "Waiting for the quote to be approved." });
    expect(await move(orderId, "RECEIVED_BY_STORE", "IN_PROGRESS")).toMatchObject({
      ok: false,
      message: "Waiting for the quote to be approved.",
    });
  });

  it("won't complete while a revised total awaits approval", async () => {
    const orderId = await makeOrder({ path: DROP_OFF_PATH, revisionAwaitingApproval: true });
    expect(await move(orderId, "READY", "COMPLETED")).toMatchObject({ ok: false, code: "NOT_OFFERED" });
    expect((await readOrder(orderId)).stage).toBe("READY");
  });

  it("refuses a move from a stage the order has already left", async () => {
    const orderId = await makeOrder({ path: upTo(DROP_OFF_PATH, "IN_PROGRESS") });
    expect(await move(orderId, "RECEIVED_BY_STORE", "IN_PROGRESS")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: CHANGED_MESSAGE,
    });
  });
});

describe("reopening", () => {
  it("clears completedAt, keeps the original Completed event, and sets a new completedAt when completed again", async () => {
    const orderId = await makeOrder({ path: [...DROP_OFF_PATH, "COMPLETED"] });
    const before = await readOrder(orderId);

    expect(await move(orderId, "COMPLETED", "READY", { as: users.owner.headers, note: NOTE })).toMatchObject({ ok: true });
    const reopened = await readOrder(orderId);
    expect(reopened.stage).toBe("READY");
    expect(reopened.completedAt).toBeNull();
    expect(reopened.statusEvents.map((event) => event.toStage)).toEqual([...DROP_OFF_PATH, "COMPLETED", "READY"]);

    expect(await move(orderId, "READY", "COMPLETED")).toMatchObject({ ok: true });
    const completed = await readOrder(orderId);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.completedAt!.getTime()).toBeGreaterThan(before.completedAt!.getTime());
    expect(completed.statusEvents.filter((event) => event.toStage === "COMPLETED")).toHaveLength(2);
  });

  it("returns a 'Customer collected instead' order to Ready, and a delivered one to Out for delivery", async () => {
    const collected = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: upTo(PICKUP_PATH, "READY") });
    await move(collected, "READY", "COMPLETED", { note: NOTE, collectedByCustomer: true });
    const delivered = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: PICKUP_PATH });
    await move(delivered, "OUT_FOR_DELIVERY", "COMPLETED");

    const collectedMoves = (await getOrderDetail(storeId, collected, "OWNER"))?.stageMoves;
    expect(collectedMoves?.secondary).toEqual([{ kind: "REOPEN", to: "READY", collectedByCustomer: false, noteRequired: true }]);
    const deliveredMoves = (await getOrderDetail(storeId, delivered, "OWNER"))?.stageMoves;
    expect(deliveredMoves?.secondary).toEqual([
      { kind: "REOPEN", to: "OUT_FOR_DELIVERY", collectedByCustomer: false, noteRequired: true },
    ]);

    expect(await move(collected, "COMPLETED", "READY", { as: users.owner.headers, note: NOTE })).toMatchObject({ ok: true });
    expect(await move(delivered, "COMPLETED", "OUT_FOR_DELIVERY", { as: users.owner.headers, note: NOTE })).toMatchObject({
      ok: true,
    });
    // Not the other way round.
    const again = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: [...PICKUP_PATH, "COMPLETED"] });
    expect(await move(again, "COMPLETED", "READY", { as: users.owner.headers, note: NOTE })).toMatchObject({ ok: false });
  });
});

describe("concurrent moves", () => {
  it("lets exactly one of two conflicting moves through", async () => {
    const orderId = await makeOrder({ path: upTo(DROP_OFF_PATH, "IN_PROGRESS") });
    const results = await Promise.all([
      move(orderId, "IN_PROGRESS", "READY"),
      move(orderId, "IN_PROGRESS", "RECEIVED_BY_STORE", { note: NOTE }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: "CONFLICT", message: CHANGED_MESSAGE }]);
    const order = await readOrder(orderId);
    expect(order.statusEvents).toHaveLength(4);
    expect(order.stage).toBe(order.statusEvents.at(-1)?.toStage);
  });
});

describe("stepping back", () => {
  it("goes back two stages when pressed twice, never bouncing between two", async () => {
    const orderId = await makeOrder({ path: DROP_OFF_PATH });
    expect(await move(orderId, "READY", "IN_PROGRESS", { note: NOTE })).toMatchObject({ ok: true });

    const detail = await getOrderDetail(storeId, orderId, "STAFF");
    expect(detail?.stageMoves.secondary.find((stageMove) => stageMove.kind === "STEP_BACK")?.to).toBe("RECEIVED_BY_STORE");
    expect(await move(orderId, "IN_PROGRESS", "RECEIVED_BY_STORE", { note: NOTE })).toMatchObject({ ok: true });
    expect((await readOrder(orderId)).stage).toBe("RECEIVED_BY_STORE");
  });

  it("isn't offered at the order's starting stage", async () => {
    const counter = await makeOrder({ path: ["RECEIVED_BY_STORE"] });
    const staffPickup = await makeOrder({ fulfilmentType: "PICKUP_DELIVERY", path: ["PICKUP_SCHEDULED"] });

    for (const [orderId, stage, previous] of [
      [counter, "RECEIVED_BY_STORE", "BOOKED"],
      [staffPickup, "PICKUP_SCHEDULED", "BOOKED"],
    ] as const) {
      const detail = await getOrderDetail(storeId, orderId, "OWNER");
      expect(detail?.stageMoves.secondary.map((stageMove) => stageMove.kind)).toEqual(["CANCEL"]);
      expect(await move(orderId, stage, previous, { note: NOTE })).toMatchObject({ ok: false });
    }
  });
});

describe("store isolation", () => {
  it("won't let a FreshFold user move a CleanWave order, even by sending its ID", async () => {
    const before = await readOrder(cleanWaveOrder.id);
    const result = await move(cleanWaveOrder.id, cleanWaveOrder.stage, "CANCELLED", { as: freshFoldStaff, note: NOTE });
    expect(result).toEqual({ ok: false, code: "NOT_FOUND", message: "Order not found." });
    expect(await readOrder(cleanWaveOrder.id)).toEqual(before);
  });
});

describe("cancelling", () => {
  it("shows Refund owed for a paid order and Nothing due for an unpaid one", async () => {
    const paid = await makeOrder({ path: upTo(DROP_OFF_PATH, "IN_PROGRESS"), paid: 500_000 });
    const unpaid = await makeOrder({ path: upTo(DROP_OFF_PATH, "IN_PROGRESS") });
    await move(paid, "IN_PROGRESS", "CANCELLED", { note: NOTE });
    await move(unpaid, "IN_PROGRESS", "CANCELLED", { note: NOTE });

    const paidDetail = await getOrderDetail(storeId, paid, "STAFF");
    expect(paidDetail?.balance).toMatchObject({ state: "REFUND_OWED", balanceKobo: -500_000 });
    expect((await getOrderDetail(storeId, unpaid, "STAFF"))?.balance.state).toBe("NOTHING_DUE");
    // Cancelled is final, and the payment is kept.
    expect(paidDetail?.stageMoves).toEqual({ primary: null, secondary: [], blockedReason: null });
    expect(paidDetail?.order.payments).toHaveLength(1);
  });

  it("can cancel an order in Quote awaiting approval, which offers no other move", async () => {
    const orderId = await makeOrder({
      path: ["RECEIVED_BY_STORE", "QUOTE_AWAITING_APPROVAL"],
      approved: false,
      revisionAwaitingApproval: true,
    });
    const detail = await getOrderDetail(storeId, orderId, "OWNER");
    expect(detail?.stageMoves).toEqual({
      primary: null,
      secondary: [{ kind: "CANCEL", to: "CANCELLED", collectedByCustomer: false, noteRequired: false }],
      blockedReason: "Waiting for the customer to approve the quote.",
    });
    expect(await move(orderId, "QUOTE_AWAITING_APPROVAL", "RECEIVED_BY_STORE", { note: NOTE })).toMatchObject({ ok: false });
    expect(await move(orderId, "QUOTE_AWAITING_APPROVAL", "CANCELLED", { note: NOTE })).toMatchObject({ ok: true });
    expect((await readOrder(orderId)).stage).toBe("CANCELLED");
  });
});
