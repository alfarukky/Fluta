import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { FulfilmentType, OrderStage, PrismaClient } from "@/generated/prisma/client";
import { toMatchKey } from "@/lib/match-key";
import type { IssueRevisionRequest } from "@/schemas/quotes";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { createUserWithPassword } from "@/server/data/users";
import { getOrderDetail } from "@/server/services/orders";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { changeOrderStage } from "./order-stages";
import { editAddress, issueRevision, recordDecision } from "./quotes";

// The actions read the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Each test builds orders and revises them through several Neon round trips.
vi.setConfig({ testTimeout: 90_000 });

const EMAIL_DOMAIN = "quotes-test.example";
const PASSWORD = "test-password-1234";
const CHANGED = "This order was just updated. Refresh to see the latest.";
const NOTE = "Approved by phone, 2:15 PM";

// Catalogue prices (kobo): Shirt ₦800 per item; Duvet from ₦1,500 per item
// (quote required). Areas: Wuse 2 fixed ₦1,500; Maitama quote required.
const SHIRT_PRICE = 80_000;
const DUVET_PRICE = 150_000;
const WUSE_CHARGE = 150_000;

let prisma: PrismaClient;
let storeId: string;
let customerId: string;
let ids: { shirt: string; duvet: string; wuse: string; maitama: string };
let users: Record<"owner" | "staff", { id: string; headers: Headers }>;
let freshFoldStaff: Headers;
let cleanWave: { orderId: string; revisionId: string | null; version: number };
let nextOrderNumber = 1;

beforeAll(async () => {
  prisma = createTestPrisma();
  const suffix = randomUUID().slice(0, 8);
  const store = await prisma.store.create({
    data: {
      name: "Quotes Test Laundry",
      slug: `quotes-test-${suffix}`,
      orderPrefix: "QT",
      subscription: { create: { planName: "Test", priceAmount: 0 } },
      customers: { create: { name: "Quote Test Customer", phone: "+2348030000002" } },
    },
    select: { id: true, customers: { select: { id: true } } },
  });
  storeId = store.id;
  customerId = store.customers[0].id;

  const service = (name: string, price: number, requiresQuote: boolean) =>
    prisma.service.create({
      data: { storeId, name, nameKey: toMatchKey(name), pricingType: "PER_ITEM", price, requiresQuote },
      select: { id: true },
    });
  const area = (name: string, fixedCharge: number | null) =>
    prisma.serviceArea.create({
      data: { storeId, name, nameKey: toMatchKey(name), chargeType: fixedCharge === null ? "QUOTE_REQUIRED" : "FIXED", fixedCharge },
      select: { id: true },
    });
  const [shirt, duvet, wuse, maitama] = await Promise.all([
    service("Shirt", SHIRT_PRICE, false),
    service("Duvet", DUVET_PRICE, true),
    area("Wuse 2", WUSE_CHARGE),
    area("Maitama", null),
  ]);
  ids = { shirt: shirt.id, duvet: duvet.id, wuse: wuse.id, maitama: maitama.id };

  users = { owner: await addUser("owner", "OWNER"), staff: await addUser("staff", "STAFF") };
  freshFoldStaff = await signInHeaders("kemi@freshfold.example");

  const cw = await prisma.order.findFirstOrThrow({
    where: { store: { slug: "cleanwave-laundry" }, stage: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { id: true, quoteRevisions: { select: { id: true, version: true, status: true }, orderBy: { version: "desc" } } },
  });
  cleanWave = {
    orderId: cw.id,
    revisionId: cw.quoteRevisions.find((revision) => revision.status === "PENDING")?.id ?? cw.quoteRevisions[0]?.id ?? null,
    version: cw.quoteRevisions[0]?.version ?? 1,
  };
}, 120_000);

afterAll(async () => {
  // Test cleanup only: the app never deletes orders, revisions, or audit events.
  const where = { storeId };
  await prisma.order.updateMany({ where, data: { approvedQuoteId: null } });
  await prisma.$transaction(
    [
      prisma.auditEvent.deleteMany({ where }),
      prisma.messageEvent.deleteMany({ where }),
      prisma.statusEvent.deleteMany({ where }),
      prisma.payment.deleteMany({ where }),
      prisma.quoteRevision.deleteMany({ where }),
      prisma.orderLine.deleteMany({ where }),
      prisma.notification.deleteMany({ where }),
      prisma.order.deleteMany({ where }),
      prisma.customer.deleteMany({ where }),
      prisma.service.deleteMany({ where }),
      prisma.serviceArea.deleteMany({ where }),
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

// ───────────── Building orders ─────────────

interface LineSpec {
  service: "shirt" | "duvet";
  quantity: number | null; // null = not counted yet (a quote-required line booked online)
  unitPrice?: number; // what the line was added at (defaults to today's price)
}

interface OrderSpec {
  fulfilmentType?: FulfilmentType;
  path: OrderStage[];
  lines: LineSpec[];
  // Version 1 approved at creation (a priced order); otherwise an estimate.
  approved?: boolean;
  area?: "wuse" | "maitama";
  charge?: number | null;
  paid?: number;
  address?: string;
}

const priceOf = (line: LineSpec) => line.unitPrice ?? (line.service === "shirt" ? SHIRT_PRICE : DUVET_PRICE);
const totalOf = (line: LineSpec) => (line.quantity === null ? 0 : priceOf(line) * line.quantity);

// An order exactly as order entry and earlier moves would have left it.
async function makeOrder(spec: OrderSpec): Promise<string> {
  const fulfilmentType = spec.fulfilmentType ?? "DROP_OFF";
  const stage = spec.path.at(-1) ?? "BOOKED";
  const at = (index: number) => new Date(Date.UTC(2026, 0, 1, 9) + index * 60_000);
  const pickup = fulfilmentType === "PICKUP_DELIVERY";
  const charge = pickup ? (spec.charge === undefined ? WUSE_CHARGE : spec.charge) : null;
  const areaId = pickup ? ids[spec.area ?? "wuse"] : null;
  const total = spec.lines.reduce((sum, line) => sum + totalOf(line), 0) + (charge ?? 0);
  const approved = spec.approved ?? true;

  const order = await prisma.order.create({
    data: {
      storeId,
      orderNumber: nextOrderNumber++,
      customerId,
      channel: "COUNTER",
      fulfilmentType,
      stage,
      stageBeforeQuote: stage === "QUOTE_AWAITING_APPROVAL" ? spec.path.at(-2) : null,
      serviceAreaId: areaId,
      serviceAreaName: pickup ? (spec.area === "maitama" ? "Maitama" : "Wuse 2") : null,
      fulfilmentCharge: charge,
      addressText: pickup ? (spec.address ?? "12 Test Street") : null,
      pickupWindowStatus: pickup ? "CONFIRMED" : null,
      trackingTokenHash: randomUUID(),
      trackingTokenIssuedAt: at(0),
      createdAt: at(0),
    },
    select: { id: true },
  });
  await prisma.orderLine.createMany({
    data: spec.lines.map((line) => ({
      storeId,
      orderId: order.id,
      lineType: "SERVICE" as const,
      serviceId: ids[line.service],
      description: line.service === "shirt" ? "Shirt" : "Duvet",
      pricingType: "PER_ITEM" as const,
      requiresQuote: line.service === "duvet",
      unitPrice: priceOf(line),
      quantity: line.quantity === null ? null : String(line.quantity),
      lineTotal: line.quantity === null ? null : totalOf(line),
    })),
  });
  const v1 = await prisma.quoteRevision.create({
    data: {
      storeId,
      orderId: order.id,
      version: 1,
      linesSnapshot: {},
      itemsSubtotal: total - (charge ?? 0),
      fulfilmentCharge: charge ?? 0,
      total,
      status: approved ? "APPROVED" : "PENDING",
      createdByActor: "STAFF",
      createdByUserId: users.staff.id,
      createdAt: at(0),
      approvedAt: approved ? at(0) : null,
      approvedByActor: approved ? "STAFF" : null,
    },
    select: { id: true },
  });
  if (approved) await prisma.order.update({ where: { id: order.id }, data: { approvedQuoteId: v1.id } });
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

async function readOrder(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      stage: true,
      stageBeforeQuote: true,
      approvedQuoteId: true,
      addressText: true,
      lines: {
        select: { id: true, lineType: true, serviceId: true, unitPrice: true, quantity: true, lineTotal: true },
        orderBy: [{ lineType: "asc" }, { id: "asc" }],
      },
      quoteRevisions: {
        select: {
          id: true,
          version: true,
          status: true,
          total: true,
          reason: true,
          customerMessage: true,
          approvedByActor: true,
          linesSnapshot: true,
        },
        orderBy: { version: "asc" },
      },
      statusEvents: {
        select: { fromStage: true, toStage: true, actorType: true, actorUserId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

// ───────────── Calling the actions ─────────────

type Body = Omit<IssueRevisionRequest, "orderId" | "basedOnVersion">;

// The editor's request for the order as it is now: every existing service
// line with its current quantity (overridable), plus whatever is added.
async function currentBody(orderId: string, quantities: Record<string, number | null> = {}): Promise<Body> {
  const order = await readOrder(orderId);
  return {
    lines: order.lines
      .filter((line) => line.lineType === "SERVICE")
      .map((line) => {
        const service = line.serviceId === ids.shirt ? "shirt" : "duvet";
        const quantity = service in quantities ? quantities[service] : line.quantity === null ? null : Number(line.quantity);
        return { kind: "existing" as const, lineId: line.id, quantity: quantity === null ? "" : String(quantity) };
      }),
    adjustments: [],
  };
}

// The body with unit prices typed on some of the existing lines, by line ID.
function withPrices(body: Body, prices: Record<string, string>): Body {
  return {
    ...body,
    lines: body.lines.map((line) => (line.kind === "existing" && line.lineId in prices ? { ...line, unitPrice: prices[line.lineId] } : line)),
  };
}

async function issue(orderId: string, body: Body, options: { as?: Headers; basedOnVersion?: number } = {}) {
  const order = await readOrder(orderId);
  request.headers = options.as ?? users.staff.headers;
  return issueRevision({
    orderId,
    basedOnVersion: options.basedOnVersion ?? order.quoteRevisions.at(-1)?.version ?? 1,
    ...body,
  });
}

async function approve(orderId: string, revisionId: string, as: Headers = users.staff.headers) {
  request.headers = as;
  return recordDecision({ decision: "APPROVE", orderId, revisionId, note: NOTE });
}

async function latestRevisionId(orderId: string): Promise<string> {
  const order = await readOrder(orderId);
  const latest = order.quoteRevisions.at(-1);
  if (!latest) throw new Error("No revisions");
  return latest.id;
}

// ───────────── First priced quote ─────────────

describe("the first priced quote", () => {
  it("counts a quote-required order booked online, moves it to Quote awaiting approval, and an approval returns it exactly", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE"], lines: [{ service: "duvet", quantity: null }], approved: false });

    const issued = await issue(orderId, await currentBody(orderId, { duvet: 4 }));
    expect(issued).toEqual({ ok: true, message: "Quote v2 sent for approval" });

    let order = await readOrder(orderId);
    expect(order.stage).toBe("QUOTE_AWAITING_APPROVAL");
    expect(order.stageBeforeQuote).toBe("RECEIVED_BY_STORE");
    expect(order.approvedQuoteId).toBeNull();
    // The estimate is superseded; version 2 waits for the customer.
    expect(order.quoteRevisions.map((revision) => [revision.version, revision.status])).toEqual([
      [1, "SUPERSEDED"],
      [2, "PENDING"],
    ]);
    // 4 × ₦1,500 = ₦6,000.
    expect(order.quoteRevisions[1].total).toBe(600_000);
    expect(order.lines).toEqual([expect.objectContaining({ quantity: expect.anything(), lineTotal: 600_000 })]);
    expect(Number(order.lines[0].quantity)).toBe(4);
    expect(order.quoteRevisions[1].linesSnapshot).toMatchObject({
      lines: [expect.objectContaining({ serviceId: ids.duvet, requiresQuote: true, quantity: "4", unitPrice: DUVET_PRICE })],
      areaName: null,
      isOutOfArea: false,
      fulfilmentCharge: null,
    });
    expect(order.statusEvents.at(-1)).toEqual({
      fromStage: "RECEIVED_BY_STORE",
      toStage: "QUOTE_AWAITING_APPROVAL",
      actorType: "SYSTEM",
      actorUserId: null,
    });

    const v2 = order.quoteRevisions[1].id;
    expect(await approve(orderId, v2)).toEqual({ ok: true, message: "Approval recorded" });
    order = await readOrder(orderId);
    expect(order.stage).toBe("RECEIVED_BY_STORE");
    expect(order.stageBeforeQuote).toBeNull();
    expect(order.approvedQuoteId).toBe(v2);
    expect(order.quoteRevisions[1]).toMatchObject({ status: "APPROVED", approvedByActor: "STAFF" });
    // The stage restoration is a system move.
    expect(order.statusEvents.at(-1)).toMatchObject({ fromStage: "QUOTE_AWAITING_APPROVAL", toStage: "RECEIVED_BY_STORE", actorType: "SYSTEM" });

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { storeId, targetId: v2 } });
    expect(audit).toMatchObject({ action: "QUOTE_APPROVAL_RECORDED", actorType: "STAFF", actorUserId: users.staff.id, reason: NOTE });

    // Work can start now.
    request.headers = users.staff.headers;
    expect(await changeOrderStage({ orderId, from: "RECEIVED_BY_STORE", to: "IN_PROGRESS" })).toMatchObject({ ok: true });
  });

  it("quotes a pickup charge from Booked", async () => {
    const orderId = await makeOrder({
      fulfilmentType: "PICKUP_DELIVERY",
      path: ["BOOKED"],
      lines: [{ service: "shirt", quantity: 3 }],
      area: "maitama",
      charge: null,
      approved: false,
    });
    const body = await currentBody(orderId);
    expect(await issue(orderId, body)).toMatchObject({ ok: false, code: "CHARGE_REQUIRED" });
    expect(await issue(orderId, { ...body, charge: "2,000" })).toMatchObject({ ok: true });

    const order = await readOrder(orderId);
    expect(order.stage).toBe("QUOTE_AWAITING_APPROVAL");
    expect(order.stageBeforeQuote).toBe("BOOKED");
    expect(order.quoteRevisions.at(-1)).toMatchObject({ total: 3 * SHIRT_PRICE + 200_000 });
    expect(order.quoteRevisions.at(-1)?.linesSnapshot).toMatchObject({ areaName: "Maitama", isOutOfArea: false, fulfilmentCharge: 200_000 });
  });

  it("never changes stageBeforeQuote on a later revision", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE"], lines: [{ service: "duvet", quantity: null }], approved: false });
    await issue(orderId, await currentBody(orderId, { duvet: 3 }));
    expect(await issue(orderId, { ...(await currentBody(orderId, { duvet: 4 })), reason: "Recounted" })).toMatchObject({ ok: true });

    const order = await readOrder(orderId);
    expect(order.stage).toBe("QUOTE_AWAITING_APPROVAL");
    expect(order.stageBeforeQuote).toBe("RECEIVED_BY_STORE");
    expect(order.quoteRevisions.map((revision) => revision.status)).toEqual(["SUPERSEDED", "SUPERSEDED", "PENDING"]);
    // Only one stage event into Quote awaiting approval.
    expect(order.statusEvents.filter((event) => event.toStage === "QUOTE_AWAITING_APPROVAL")).toHaveLength(1);
  });
});

// ───────────── Revisions after the first approved quote ─────────────

describe("revising an approved order", () => {
  it("leaves the stage alone after work has started, blocks completion until approved, and moves the balance only on approval", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"], lines: [{ service: "shirt", quantity: 3 }] });
    const balance = async () => (await getOrderDetail(storeId, orderId, "STAFF"))?.balance;
    expect(await balance()).toMatchObject({ state: "OUTSTANDING", balanceKobo: 240_000 });

    const body = { ...(await currentBody(orderId)), lines: [...(await currentBody(orderId)).lines, { kind: "new" as const, serviceId: ids.shirt, quantity: "2" }] };
    // A reason is required once the order has an approved quote.
    expect(await issue(orderId, body)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(await issue(orderId, { ...body, reason: "Two more shirts found" })).toEqual({
      ok: true,
      message: "Revised quote v2 sent for approval",
    });

    let order = await readOrder(orderId);
    expect(order.stage).toBe("IN_PROGRESS");
    expect(order.stageBeforeQuote).toBeNull();
    expect(order.quoteRevisions.at(-1)).toMatchObject({ status: "PENDING", total: 400_000, reason: "Two more shirts found" });
    // The working lines show the proposal; the balance stays on the approved total.
    expect(order.lines).toHaveLength(2);
    expect(await balance()).toMatchObject({ state: "OUTSTANDING", balanceKobo: 240_000 });

    request.headers = users.staff.headers;
    expect(await changeOrderStage({ orderId, from: "IN_PROGRESS", to: "READY" })).toMatchObject({ ok: true });
    expect(await changeOrderStage({ orderId, from: "READY", to: "COMPLETED" })).toMatchObject({
      ok: false,
      message: "Waiting for the customer to approve the revised total.",
    });

    expect(await approve(orderId, await latestRevisionId(orderId))).toMatchObject({ ok: true });
    order = await readOrder(orderId);
    expect(order.stage).toBe("READY");
    expect(order.quoteRevisions.map((revision) => revision.status)).toEqual(["SUPERSEDED", "APPROVED"]);
    expect(await balance()).toMatchObject({ state: "OUTSTANDING", balanceKobo: 400_000 });
    request.headers = users.staff.headers;
    expect(await changeOrderStage({ orderId, from: "READY", to: "COMPLETED" })).toMatchObject({ ok: true });
  });

  it("shows Refund owed when a paid order's total goes down, and Outstanding when it goes up", async () => {
    const lower = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"], lines: [{ service: "shirt", quantity: 5 }], paid: 400_000 });
    const higher = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"], lines: [{ service: "shirt", quantity: 5 }], paid: 400_000 });

    await issue(lower, { ...(await currentBody(lower, { shirt: 4 })), reason: "One shirt was a duplicate" });
    await approve(lower, await latestRevisionId(lower));
    expect((await getOrderDetail(storeId, lower, "STAFF"))?.balance).toMatchObject({ state: "REFUND_OWED", balanceKobo: -80_000 });

    await issue(higher, { ...(await currentBody(higher, { shirt: 6 })), reason: "One more shirt" });
    await approve(higher, await latestRevisionId(higher));
    expect((await getOrderDetail(storeId, higher, "STAFF"))?.balance).toMatchObject({ state: "OUTSTANDING", balanceKobo: 80_000 });
  });

  it("supersedes the pending revision, which can no longer be approved", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"], lines: [{ service: "shirt", quantity: 3 }] });
    await issue(orderId, { ...(await currentBody(orderId, { shirt: 4 })), reason: "One more" });
    const first = await latestRevisionId(orderId);
    await issue(orderId, { ...(await currentBody(orderId, { shirt: 5 })), reason: "Two more" });

    expect(await approve(orderId, first)).toEqual({ ok: false, code: "CONFLICT", message: CHANGED });
    const order = await readOrder(orderId);
    expect(order.quoteRevisions.map((revision) => revision.status)).toEqual(["APPROVED", "SUPERSEDED", "PENDING"]);
    expect(order.approvedQuoteId).toBe(order.quoteRevisions[0].id);
  });

  it("keeps an existing line's original price, and ignores totals or a fixed charge sent by the browser", async () => {
    // Added when shirts were ₦700; the catalogue now says ₦800.
    const orderId = await makeOrder({
      fulfilmentType: "PICKUP_DELIVERY",
      path: ["PICKUP_SCHEDULED", "PICKED_UP", "RECEIVED_BY_STORE"],
      lines: [{ service: "shirt", quantity: 2, unitPrice: 70_000 }],
    });
    const body = await currentBody(orderId);
    const tampered = {
      ...body,
      lines: [
        { ...body.lines[0], lineTotal: 1 },
        { kind: "new" as const, serviceId: ids.shirt, quantity: "1", lineTotal: 1 },
      ],
      area: { kind: "current" as const },
      charge: "1",
      reason: "One more shirt",
    } as unknown as Body;
    expect(await issue(orderId, tampered)).toMatchObject({ ok: true });

    const order = await readOrder(orderId);
    expect(order.lines.map((line) => [line.unitPrice, line.lineTotal])).toEqual([
      [70_000, 140_000],
      [SHIRT_PRICE, SHIRT_PRICE],
    ]);
    // Wuse 2's fixed charge, whatever the request said.
    expect(order.quoteRevisions.at(-1)?.total).toBe(140_000 + SHIRT_PRICE + WUSE_CHARGE);
  });

  it("refuses a negative total", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"], lines: [{ service: "shirt", quantity: 1 }] });
    const body = {
      ...(await currentBody(orderId)),
      adjustments: [{ description: "Goodwill", kind: "DISCOUNT" as const, amount: "1,000" }],
      reason: "Goodwill",
    };
    expect(await issue(orderId, body)).toMatchObject({ ok: false, code: "NEGATIVE_TOTAL" });
    expect((await readOrder(orderId)).quoteRevisions).toHaveLength(1);
  });

  it("is refused once the order is out for delivery", async () => {
    const orderId = await makeOrder({
      fulfilmentType: "PICKUP_DELIVERY",
      path: ["PICKUP_SCHEDULED", "PICKED_UP", "RECEIVED_BY_STORE", "IN_PROGRESS", "READY", "OUT_FOR_DELIVERY"],
      lines: [{ service: "shirt", quantity: 2 }],
    });
    expect(await issue(orderId, { ...(await currentBody(orderId)), reason: "Late change" })).toMatchObject({
      ok: false,
      code: "NOT_REVISABLE",
      message: "The quote can't be changed once an order is out for delivery.",
    });
    expect(await getOrderDetail(storeId, orderId, "STAFF")).toMatchObject({ quote: { canEdit: false } });
  });
});

// ───────────── Declining ─────────────

describe("quantities", () => {
  it("refuses a fractional or out-of-range quantity sent directly, changing nothing", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE"], lines: [{ service: "duvet", quantity: null }], approved: false });
    const before = await readOrder(orderId);
    for (const quantity of ["1.5", "2.0", "0", "1000", ""]) {
      const body = await currentBody(orderId);
      const result = await issue(orderId, { ...body, lines: [{ ...body.lines[0], quantity }] });
      expect(result).toMatchObject({ ok: false, fieldErrors: { "lines.0.quantity": expect.any(String) } });
    }
    expect(await readOrder(orderId)).toEqual(before);
  });
});

describe("pricing quote-required lines", () => {
  it("issues a revision with the new unit price, and moves the balance only on approval", async () => {
    // 2 duvets at the ₦1,500 "from" price, approved: ₦3,000.
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"], lines: [{ service: "duvet", quantity: 2 }, { service: "shirt", quantity: 1 }] });
    const balance = async () => (await getOrderDetail(storeId, orderId, "STAFF"))?.balance;
    expect(await balance()).toMatchObject({ balanceKobo: 300_000 + SHIRT_PRICE });

    const duvetId = (await readOrder(orderId)).lines.find((line) => line.serviceId === ids.duvet)!.id;
    const body = withPrices(await currentBody(orderId), { [duvetId]: "₦2,250.50" });
    expect(await issue(orderId, { ...body, reason: "Heavy items, priced after inspection" })).toMatchObject({ ok: true });

    const order = await readOrder(orderId);
    const latest = order.quoteRevisions.at(-1);
    // 2 × ₦2,250.50 = ₦4,501, plus the shirt at its fixed ₦800.
    expect(latest).toMatchObject({ version: 2, status: "PENDING", total: 450_100 + SHIRT_PRICE });
    const snapshot = latest?.linesSnapshot as { lines: { serviceId: string; unitPrice: number; lineTotal: number }[] };
    expect(snapshot.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serviceId: ids.duvet, unitPrice: 225_050, lineTotal: 450_100 }),
        expect.objectContaining({ serviceId: ids.shirt, unitPrice: SHIRT_PRICE, lineTotal: SHIRT_PRICE }),
      ]),
    );
    // The working line carries the new price once issued; the revision before it is untouched.
    expect(order.lines.find((line) => line.serviceId === ids.duvet)).toMatchObject({ unitPrice: 225_050, lineTotal: 450_100 });
    expect(order.quoteRevisions[0]).toMatchObject({ status: "APPROVED", total: 300_000 + SHIRT_PRICE });
    expect(await balance()).toMatchObject({ balanceKobo: 300_000 + SHIRT_PRICE });

    expect(await approve(orderId, await latestRevisionId(orderId))).toMatchObject({ ok: true });
    expect(await balance()).toMatchObject({ balanceKobo: 450_100 + SHIRT_PRICE });
  });

  it("keeps a quote-required line's price when none is sent", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE"], lines: [{ service: "duvet", quantity: null }], approved: false });
    expect(await issue(orderId, await currentBody(orderId, { duvet: 3 }))).toMatchObject({ ok: true });
    const order = await readOrder(orderId);
    expect(order.lines[0]).toMatchObject({ unitPrice: DUVET_PRICE, lineTotal: 450_000 });
    expect(order.quoteRevisions.at(-1)?.total).toBe(450_000);
  });

  it("refuses a price for a fixed-price line, or an invalid price, creating nothing", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"], lines: [{ service: "duvet", quantity: 2 }, { service: "shirt", quantity: 1 }] });
    const before = await readOrder(orderId);
    const body = { ...(await currentBody(orderId)), reason: "Repriced" };
    const shirtId = before.lines.find((line) => line.serviceId === ids.shirt)!.id;
    const duvetId = before.lines.find((line) => line.serviceId === ids.duvet)!.id;

    // Even the shirt's current price, alongside a valid quote-required price.
    expect(await issue(orderId, withPrices(body, { [shirtId]: "800", [duvetId]: "2,000" }))).toMatchObject({
      ok: false,
      code: "PRICE_NOT_ALLOWED",
      message: CHANGED,
    });
    // A new fixed-price service can't be priced either.
    expect(
      await issue(orderId, { ...body, lines: [...body.lines, { kind: "new", serviceId: ids.shirt, quantity: "1", unitPrice: "1" }] }),
    ).toMatchObject({ ok: false, code: "PRICE_NOT_ALLOWED" });
    for (const price of ["-5", "10,000,000.01", "1.234", "two thousand"]) {
      const index = body.lines.findIndex((line) => line.kind === "existing" && line.lineId === duvetId);
      const result = await issue(orderId, withPrices(body, { [duvetId]: price }));
      expect(result).toMatchObject({ ok: false, fieldErrors: { [`lines.${index}.unitPrice`]: expect.any(String) } });
    }
    expect(await readOrder(orderId)).toEqual(before);
  });
});

describe("recording a decline", () => {
  it("stores the customer's reason and the audit note separately, keeps the order where it is, and allows a new revision", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE"], lines: [{ service: "duvet", quantity: null }], approved: false });
    await issue(orderId, await currentBody(orderId, { duvet: 5 }));
    const v2 = await latestRevisionId(orderId);

    request.headers = users.owner.headers;
    expect(
      await recordDecision({ decision: "DECLINE", orderId, revisionId: v2, customerMessage: "Too expensive", note: "Said so at the counter" }),
    ).toEqual({ ok: true, message: "Decline recorded" });

    let order = await readOrder(orderId);
    expect(order.stage).toBe("QUOTE_AWAITING_APPROVAL");
    expect(order.stageBeforeQuote).toBe("RECEIVED_BY_STORE");
    expect(order.quoteRevisions.at(-1)).toMatchObject({ status: "DECLINED", customerMessage: "Too expensive" });
    expect(await prisma.auditEvent.findFirstOrThrow({ where: { storeId, targetId: v2 } })).toMatchObject({
      action: "QUOTE_DECLINE_RECORDED",
      actorUserId: users.owner.id,
      reason: "Said so at the counter",
    });
    // A declined revision can't be approved afterwards.
    expect(await approve(orderId, v2)).toMatchObject({ ok: false, code: "CONFLICT" });

    expect(await issue(orderId, { ...(await currentBody(orderId, { duvet: 4 })), reason: "Recounted" })).toMatchObject({ ok: true });
    order = await readOrder(orderId);
    expect(order.quoteRevisions.map((revision) => revision.status)).toEqual(["SUPERSEDED", "DECLINED", "PENDING"]);
    expect(order.stageBeforeQuote).toBe("RECEIVED_BY_STORE");
  });

  it("requires the customer's reason", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE"], lines: [{ service: "duvet", quantity: null }], approved: false });
    await issue(orderId, await currentBody(orderId, { duvet: 5 }));
    request.headers = users.staff.headers;
    expect(
      await recordDecision({ decision: "DECLINE", orderId, revisionId: await latestRevisionId(orderId), customerMessage: "  " }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

// ───────────── At the same moment ─────────────

describe("concurrent requests", () => {
  it("lets one of two revisions issued at the same moment through, with unique versions", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"], lines: [{ service: "shirt", quantity: 3 }] });
    const [a, b] = await Promise.all([
      issue(orderId, { ...(await currentBody(orderId, { shirt: 4 })), reason: "One more" }),
      issue(orderId, { ...(await currentBody(orderId, { shirt: 5 })), reason: "Two more" }),
    ]);
    expect([a, b].filter((result) => result.ok)).toHaveLength(1);
    expect([a, b].filter((result) => !result.ok)).toEqual([{ ok: false, code: "CONFLICT", message: CHANGED }]);

    const order = await readOrder(orderId);
    expect(order.quoteRevisions.map((revision) => revision.version)).toEqual([1, 2]);
  });

  it("lets exactly one of two approvals of the same revision through", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE"], lines: [{ service: "duvet", quantity: null }], approved: false });
    await issue(orderId, await currentBody(orderId, { duvet: 5 }));
    const v2 = await latestRevisionId(orderId);

    const results = await Promise.all([approve(orderId, v2, users.staff.headers), approve(orderId, v2, users.staff.headers)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: "CONFLICT", message: CHANGED }]);

    const order = await readOrder(orderId);
    expect(order.quoteRevisions.filter((revision) => revision.status === "APPROVED")).toHaveLength(1);
    expect(order.approvedQuoteId).toBe(v2);
    expect(order.stage).toBe("RECEIVED_BY_STORE");
    expect(order.statusEvents.filter((event) => event.fromStage === "QUOTE_AWAITING_APPROVAL")).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { storeId, targetId: v2 } })).toBe(1);
  });

  it("refuses an editor opened on an older version", async () => {
    const orderId = await makeOrder({ path: ["RECEIVED_BY_STORE", "IN_PROGRESS"], lines: [{ service: "shirt", quantity: 3 }] });
    const body = { ...(await currentBody(orderId, { shirt: 4 })), reason: "One more" };
    await issue(orderId, body);
    expect(await issue(orderId, body, { basedOnVersion: 1 })).toEqual({ ok: false, code: "CONFLICT", message: CHANGED });
  });
});

// ───────────── Store isolation ─────────────

describe("store isolation", () => {
  it("won't let a FreshFold user revise or approve a CleanWave order, even by sending its IDs", async () => {
    const before = await readOrder(cleanWave.orderId);
    request.headers = freshFoldStaff;
    expect(
      await issueRevision({ orderId: cleanWave.orderId, basedOnVersion: cleanWave.version, lines: [], adjustments: [], reason: "x" }),
    ).toEqual({ ok: false, code: "NOT_FOUND", message: "Order not found." });
    if (cleanWave.revisionId) {
      expect(await approve(cleanWave.orderId, cleanWave.revisionId, freshFoldStaff)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    }
    // Nor price a CleanWave line, even by sending the line's own ID.
    const cleanWaveLines = await prisma.orderLine.findMany({
      where: { orderId: cleanWave.orderId, lineType: "SERVICE" },
      select: { id: true },
    });
    expect(
      await issueRevision({
        orderId: cleanWave.orderId,
        basedOnVersion: cleanWave.version,
        lines: cleanWaveLines.map((line) => ({ kind: "existing", lineId: line.id, quantity: "1", unitPrice: "1" })),
        adjustments: [],
        reason: "x",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND", message: "Order not found." });
    // A FreshFold order ID with a CleanWave revision ID matches nothing either.
    const own = await makeOrder({ path: ["RECEIVED_BY_STORE"], lines: [{ service: "shirt", quantity: 1 }] });
    if (cleanWave.revisionId) expect(await approve(own, cleanWave.revisionId)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    // A FreshFold order sent with a CleanWave line ID and a price: that line isn't this order's.
    request.headers = users.staff.headers;
    expect(
      await issueRevision({
        orderId: own,
        basedOnVersion: 1,
        lines: cleanWaveLines.slice(0, 1).map((line) => ({ kind: "existing", lineId: line.id, quantity: "1", unitPrice: "1" })),
        adjustments: [],
        reason: "x",
      }),
    ).toMatchObject({ ok: false, code: "LINE_UNAVAILABLE" });
    expect(await readOrder(cleanWave.orderId)).toEqual(before);
  });
});

// ───────────── Address ─────────────

describe("editing the address", () => {
  it("writes an audit event with the old and new address", async () => {
    const orderId = await makeOrder({
      fulfilmentType: "PICKUP_DELIVERY",
      path: ["PICKUP_SCHEDULED"],
      lines: [{ service: "shirt", quantity: 1 }],
      address: "1 Old Road",
    });
    request.headers = users.staff.headers;
    expect(await editAddress({ orderId, address: "  2 New Close, Wuse 2  " })).toEqual({ ok: true, message: "Address updated" });
    expect((await readOrder(orderId)).addressText).toBe("2 New Close, Wuse 2");
    expect(await prisma.auditEvent.findFirstOrThrow({ where: { storeId, targetId: orderId } })).toMatchObject({
      action: "ORDER_ADDRESS_CHANGED",
      targetType: "Order",
      actorUserId: users.staff.id,
      metadata: { from: "1 Old Road", to: "2 New Close, Wuse 2" },
    });
  });

  it("works only for pickup orders, and not once the order is out for delivery", async () => {
    const dropOff = await makeOrder({ path: ["RECEIVED_BY_STORE"], lines: [{ service: "shirt", quantity: 1 }] });
    const delivering = await makeOrder({
      fulfilmentType: "PICKUP_DELIVERY",
      path: ["PICKUP_SCHEDULED", "PICKED_UP", "RECEIVED_BY_STORE", "IN_PROGRESS", "READY", "OUT_FOR_DELIVERY"],
      lines: [{ service: "shirt", quantity: 1 }],
    });
    request.headers = users.staff.headers;
    expect(await editAddress({ orderId: dropOff, address: "3 Somewhere" })).toMatchObject({
      ok: false,
      message: "Only pickup & delivery orders have an address.",
    });
    expect(await editAddress({ orderId: delivering, address: "3 Somewhere" })).toMatchObject({
      ok: false,
      message: "The address can't be changed once an order is out for delivery.",
    });
    expect(await prisma.auditEvent.count({ where: { storeId, targetId: { in: [dropOff, delivering] } } })).toBe(0);
  });
});
