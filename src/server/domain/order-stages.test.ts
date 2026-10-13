import { describe, expect, it } from "vitest";

import type { FulfilmentType, OrderStage, StoreRole } from "@/generated/prisma/client";

import {
  canTransition,
  findAvailableMove,
  getAvailableTransitions,
  getPreviousStage,
  getStageOrderState,
  type StageOrderState,
  type TransitionContext,
} from "./order-stages";

const STAGES: OrderStage[] = [
  "BOOKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "RECEIVED_BY_STORE",
  "QUOTE_AWAITING_APPROVAL",
  "IN_PROGRESS",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
];
const OPEN_STAGES = STAGES.filter((stage) => stage !== "COMPLETED" && stage !== "CANCELLED");
const FULFILMENT_TYPES: FulfilmentType[] = ["DROP_OFF", "PICKUP_DELIVERY"];
const ROLES: StoreRole[] = ["STAFF", "OWNER"];

// Everything that could block a move is satisfied: an approved quote, nothing
// awaiting approval, a note, a confirmed window, and an order that started at
// Booked. Only the table itself decides.
function context(overrides: Partial<TransitionContext> = {}): TransitionContext {
  const fulfilmentType = overrides.fulfilmentType ?? "DROP_OFF";
  return {
    fulfilmentType,
    actor: "STAFF",
    hasApprovedQuote: true,
    hasRevisionAwaitingApproval: false,
    note: "Fixing a mistake",
    startingStage: "BOOKED",
    completedFromStage: fulfilmentType === "DROP_OFF" ? "READY" : "OUT_FOR_DELIVERY",
    collectedByCustomer: false,
    stageBeforeQuote: "RECEIVED_BY_STORE",
    pickupWindowConfirmed: true,
    ...overrides,
  };
}

const cancels = OPEN_STAGES.map((stage) => `${stage}>CANCELLED`);

// The allowed moves for each fulfilment type and role, with the context above.
const ALLOWED: Record<FulfilmentType, Record<StoreRole, string[]>> = {
  DROP_OFF: {
    STAFF: [
      "BOOKED>RECEIVED_BY_STORE",
      "RECEIVED_BY_STORE>IN_PROGRESS",
      "IN_PROGRESS>READY",
      "READY>COMPLETED",
      "RECEIVED_BY_STORE>BOOKED",
      "IN_PROGRESS>RECEIVED_BY_STORE",
      "READY>IN_PROGRESS",
      ...cancels,
    ],
    OWNER: [],
  },
  PICKUP_DELIVERY: {
    STAFF: [
      "BOOKED>PICKUP_SCHEDULED",
      "PICKUP_SCHEDULED>PICKED_UP",
      "PICKED_UP>RECEIVED_BY_STORE",
      "RECEIVED_BY_STORE>IN_PROGRESS",
      "IN_PROGRESS>READY",
      "READY>OUT_FOR_DELIVERY",
      "OUT_FOR_DELIVERY>COMPLETED",
      "PICKUP_SCHEDULED>BOOKED",
      "PICKED_UP>PICKUP_SCHEDULED",
      "RECEIVED_BY_STORE>PICKED_UP",
      "IN_PROGRESS>RECEIVED_BY_STORE",
      "READY>IN_PROGRESS",
      "OUT_FOR_DELIVERY>READY",
      ...cancels,
    ],
    OWNER: [],
  },
};
ALLOWED.DROP_OFF.OWNER = [...ALLOWED.DROP_OFF.STAFF, "COMPLETED>READY"];
ALLOWED.PICKUP_DELIVERY.OWNER = [...ALLOWED.PICKUP_DELIVERY.STAFF, "COMPLETED>OUT_FOR_DELIVERY"];

describe("canTransition: every from and to stage", () => {
  for (const fulfilmentType of FULFILMENT_TYPES) {
    for (const role of ROLES) {
      it(`${fulfilmentType}, ${role}`, () => {
        const allowed: string[] = [];
        for (const from of STAGES) {
          for (const to of STAGES) {
            const result = canTransition(from, to, context({ fulfilmentType, actor: role }));
            if (result.allowed) allowed.push(`${from}>${to}`);
            else expect(result.reason).toMatch(/\S/);
          }
        }
        expect(allowed.sort()).toEqual([...ALLOWED[fulfilmentType][role]].sort());
      });
    }
  }
});

describe("canTransition: notes", () => {
  it("requires a note from staff to cancel, but not from owners", () => {
    expect(canTransition("IN_PROGRESS", "CANCELLED", context({ note: null }))).toMatchObject({
      allowed: false,
      code: "NOTE_REQUIRED",
    });
    expect(canTransition("IN_PROGRESS", "CANCELLED", context({ note: null, actor: "OWNER" }))).toEqual({ allowed: true });
  });

  it("requires a note to step back, for staff and owners", () => {
    for (const actor of ROLES) {
      expect(canTransition("READY", "IN_PROGRESS", context({ note: null, actor }))).toMatchObject({ code: "NOTE_REQUIRED" });
    }
  });

  it("requires a note to reopen a completed order", () => {
    expect(canTransition("COMPLETED", "READY", context({ note: null, actor: "OWNER" }))).toMatchObject({
      code: "NOTE_REQUIRED",
    });
  });

  it("needs no note to move forward", () => {
    expect(canTransition("IN_PROGRESS", "READY", context({ note: null }))).toEqual({ allowed: true });
    expect(canTransition("READY", "COMPLETED", context({ note: null }))).toEqual({ allowed: true });
  });
});

describe("canTransition: reopening", () => {
  it("is for owners only", () => {
    const result = canTransition("COMPLETED", "READY", context({ actor: "STAFF" }));
    expect(result).toMatchObject({ allowed: false, code: "NOT_ALLOWED" });
  });

  it("returns only to the stage the order was completed from", () => {
    const owner = { actor: "OWNER" as const, fulfilmentType: "PICKUP_DELIVERY" as const };
    expect(canTransition("COMPLETED", "READY", context({ ...owner, completedFromStage: "READY" })).allowed).toBe(true);
    expect(canTransition("COMPLETED", "OUT_FOR_DELIVERY", context({ ...owner, completedFromStage: "READY" })).allowed).toBe(
      false,
    );
  });

  it("can't cancel a completed order", () => {
    expect(canTransition("COMPLETED", "CANCELLED", context({ actor: "OWNER" })).allowed).toBe(false);
  });
});

describe("canTransition: cancelled is final", () => {
  for (const to of STAGES) {
    it(`refuses Cancelled → ${to}`, () => {
      expect(canTransition("CANCELLED", to, context({ actor: "OWNER" })).allowed).toBe(false);
    });
  }
});

describe("canTransition: quotes", () => {
  it("won't start work without an approved quote", () => {
    expect(canTransition("RECEIVED_BY_STORE", "IN_PROGRESS", context({ hasApprovedQuote: false }))).toEqual({
      allowed: false,
      code: "NOT_ALLOWED",
      reason: "Waiting for the quote to be approved.",
    });
  });

  it("won't start work or complete while a revision awaits approval", () => {
    const waiting = { hasRevisionAwaitingApproval: true };
    expect(canTransition("RECEIVED_BY_STORE", "IN_PROGRESS", context(waiting)).allowed).toBe(false);
    expect(canTransition("READY", "COMPLETED", context(waiting)).allowed).toBe(false);
    const pickup = { ...waiting, fulfilmentType: "PICKUP_DELIVERY" as const };
    expect(canTransition("OUT_FOR_DELIVERY", "COMPLETED", context(pickup)).allowed).toBe(false);
    expect(canTransition("READY", "COMPLETED", context({ ...pickup, collectedByCustomer: true })).allowed).toBe(false);
  });

  it("still lets work be marked ready while a revision awaits approval", () => {
    expect(canTransition("IN_PROGRESS", "READY", context({ hasRevisionAwaitingApproval: true })).allowed).toBe(true);
  });

  it("allows cancelling from Quote awaiting approval, and nothing else by staff", () => {
    for (const actor of ROLES) {
      for (const to of STAGES) {
        const allowed = canTransition("QUOTE_AWAITING_APPROVAL", to, context({ actor })).allowed;
        expect(allowed, `${actor} → ${to}`).toBe(to === "CANCELLED");
      }
    }
  });

  it("returns to the stage before the quote only on the customer's approval", () => {
    const approval = (actor: TransitionContext["actor"]) =>
      canTransition("QUOTE_AWAITING_APPROVAL", "RECEIVED_BY_STORE", context({ actor })).allowed;
    expect(approval("CUSTOMER")).toBe(true);
    expect(approval("SYSTEM")).toBe(true);
    expect(approval("STAFF")).toBe(false);
  });

  it("moves into Quote awaiting approval only automatically", () => {
    const pickup = { fulfilmentType: "PICKUP_DELIVERY" as const };
    expect(canTransition("RECEIVED_BY_STORE", "QUOTE_AWAITING_APPROVAL", context({ actor: "SYSTEM" })).allowed).toBe(true);
    expect(canTransition("RECEIVED_BY_STORE", "QUOTE_AWAITING_APPROVAL", context()).allowed).toBe(false);
    expect(canTransition("BOOKED", "QUOTE_AWAITING_APPROVAL", context({ ...pickup, actor: "SYSTEM" })).allowed).toBe(true);
    expect(canTransition("BOOKED", "QUOTE_AWAITING_APPROVAL", context({ actor: "SYSTEM" })).allowed).toBe(false);
  });

  it("schedules a pickup only once the window is confirmed and no pickup charge awaits approval", () => {
    const pickup = { fulfilmentType: "PICKUP_DELIVERY" as const };
    expect(canTransition("BOOKED", "PICKUP_SCHEDULED", context({ ...pickup, actor: "CUSTOMER" })).allowed).toBe(true);
    expect(canTransition("BOOKED", "PICKUP_SCHEDULED", context({ ...pickup, pickupWindowConfirmed: false })).allowed).toBe(
      false,
    );
    expect(
      canTransition("BOOKED", "PICKUP_SCHEDULED", context({ ...pickup, hasRevisionAwaitingApproval: true })).allowed,
    ).toBe(false);
  });
});

describe("canTransition: customer collected instead", () => {
  const pickup = { fulfilmentType: "PICKUP_DELIVERY" as const };

  it("is refused without collectedByCustomer", () => {
    expect(canTransition("READY", "COMPLETED", context({ ...pickup, collectedByCustomer: false })).allowed).toBe(false);
  });

  it("is refused with collectedByCustomer but no note", () => {
    expect(canTransition("READY", "COMPLETED", context({ ...pickup, collectedByCustomer: true, note: null }))).toMatchObject({
      allowed: false,
      code: "NOTE_REQUIRED",
    });
  });

  it("is allowed with both", () => {
    expect(canTransition("READY", "COMPLETED", context({ ...pickup, collectedByCustomer: true })).allowed).toBe(true);
  });
});

describe("canTransition: stepping back", () => {
  it("never steps back from the order's starting stage", () => {
    expect(canTransition("RECEIVED_BY_STORE", "BOOKED", context({ startingStage: "RECEIVED_BY_STORE" })).allowed).toBe(false);
    const pickup = { fulfilmentType: "PICKUP_DELIVERY" as const, startingStage: "PICKUP_SCHEDULED" as const };
    expect(canTransition("PICKUP_SCHEDULED", "BOOKED", context(pickup)).allowed).toBe(false);
    expect(canTransition("PICKED_UP", "PICKUP_SCHEDULED", context(pickup)).allowed).toBe(true);
  });

  it("goes back only one stage", () => {
    expect(canTransition("READY", "RECEIVED_BY_STORE", context()).allowed).toBe(false);
  });

  it("uses the fixed previous stage", () => {
    expect(getPreviousStage("RECEIVED_BY_STORE", "DROP_OFF")).toBe("BOOKED");
    expect(getPreviousStage("RECEIVED_BY_STORE", "PICKUP_DELIVERY")).toBe("PICKED_UP");
    expect(getPreviousStage("QUOTE_AWAITING_APPROVAL", "DROP_OFF")).toBeNull();
    expect(getPreviousStage("BOOKED", "PICKUP_DELIVERY")).toBeNull();
  });
});

// ───────────── getAvailableTransitions ─────────────

function order(overrides: Partial<StageOrderState> = {}): StageOrderState {
  const base = context({ fulfilmentType: overrides.fulfilmentType });
  return {
    stage: "BOOKED",
    fulfilmentType: base.fulfilmentType,
    hasApprovedQuote: base.hasApprovedQuote,
    hasRevisionAwaitingApproval: base.hasRevisionAwaitingApproval,
    startingStage: base.startingStage,
    completedFromStage: base.completedFromStage,
    stageBeforeQuote: base.stageBeforeQuote,
    pickupWindowConfirmed: base.pickupWindowConfirmed,
    ...overrides,
  };
}

const summarize = (state: StageOrderState, role: StoreRole = "STAFF") => {
  const { primary, secondary, blockedReason } = getAvailableTransitions(state, role);
  return {
    primary: primary && `${primary.kind}>${primary.to}`,
    secondary: secondary.map((move) => `${move.kind}>${move.to}${move.noteRequired ? " (note)" : ""}`),
    blockedReason,
  };
};

describe("getAvailableTransitions", () => {
  it("offers the drop-off flow", () => {
    expect(summarize(order({ stage: "BOOKED" }))).toEqual({
      primary: "ADVANCE>RECEIVED_BY_STORE",
      secondary: ["CANCEL>CANCELLED (note)"],
      blockedReason: null,
    });
    expect(summarize(order({ stage: "READY" }))).toEqual({
      primary: "ADVANCE>COMPLETED",
      secondary: ["STEP_BACK>IN_PROGRESS (note)", "CANCEL>CANCELLED (note)"],
      blockedReason: null,
    });
  });

  it("offers Customer collected instead on a pickup order at Ready", () => {
    const ready = order({ stage: "READY", fulfilmentType: "PICKUP_DELIVERY" });
    expect(summarize(ready)).toEqual({
      primary: "ADVANCE>OUT_FOR_DELIVERY",
      secondary: ["COLLECTED_INSTEAD>COMPLETED (note)", "STEP_BACK>IN_PROGRESS (note)", "CANCEL>CANCELLED (note)"],
      blockedReason: null,
    });
  });

  it("lets owners cancel without a note", () => {
    expect(summarize(order({ stage: "IN_PROGRESS" }), "OWNER").secondary).toContain("CANCEL>CANCELLED");
  });

  it("offers only cancelling in Quote awaiting approval", () => {
    expect(summarize(order({ stage: "QUOTE_AWAITING_APPROVAL" }))).toEqual({
      primary: null,
      secondary: ["CANCEL>CANCELLED (note)"],
      blockedReason: "Waiting for the customer to approve the quote.",
    });
  });

  it("explains why work can't start on an unpriced order", () => {
    expect(summarize(order({ stage: "RECEIVED_BY_STORE", hasApprovedQuote: false }))).toEqual({
      primary: null,
      secondary: ["STEP_BACK>BOOKED (note)", "CANCEL>CANCELLED (note)"],
      blockedReason: "Waiting for the quote to be approved.",
    });
  });

  it("doesn't offer Booked → Pickup scheduled (online bookings come later)", () => {
    const booked = order({ stage: "BOOKED", fulfilmentType: "PICKUP_DELIVERY", pickupWindowConfirmed: false });
    expect(summarize(booked)).toEqual({
      primary: null,
      secondary: ["CANCEL>CANCELLED (note)"],
      blockedReason: "Waiting for the pickup window to be confirmed.",
    });
  });

  it("offers no step back at the starting stage", () => {
    const counter = order({ stage: "RECEIVED_BY_STORE", startingStage: "RECEIVED_BY_STORE" });
    expect(summarize(counter).secondary).toEqual(["CANCEL>CANCELLED (note)"]);
    const staffPickup = order({ stage: "PICKUP_SCHEDULED", fulfilmentType: "PICKUP_DELIVERY", startingStage: "PICKUP_SCHEDULED" });
    expect(summarize(staffPickup).secondary).toEqual(["CANCEL>CANCELLED (note)"]);
  });

  it("offers reopening a completed order to owners only", () => {
    const completed = order({ stage: "COMPLETED", completedFromStage: "READY" });
    expect(summarize(completed, "OWNER")).toEqual({ primary: null, secondary: ["REOPEN>READY (note)"], blockedReason: null });
    expect(summarize(completed, "STAFF")).toEqual({ primary: null, secondary: [], blockedReason: null });
  });

  it("offers nothing on a cancelled order", () => {
    expect(summarize(order({ stage: "CANCELLED" }), "OWNER")).toEqual({ primary: null, secondary: [], blockedReason: null });
  });

  it("finds only offered moves", () => {
    const booked = order({ stage: "BOOKED", fulfilmentType: "PICKUP_DELIVERY" });
    // canTransition allows it, but it belongs to online bookings.
    expect(findAvailableMove(booked, "STAFF", "PICKUP_SCHEDULED", false)).toBeNull();
    const ready = order({ stage: "READY", fulfilmentType: "PICKUP_DELIVERY" });
    expect(findAvailableMove(ready, "STAFF", "COMPLETED", true)).toMatchObject({ kind: "COLLECTED_INSTEAD" });
    expect(findAvailableMove(ready, "STAFF", "COMPLETED", false)).toBeNull();
  });
});

describe("getStageOrderState", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 9, minute));
  const record = {
    stage: "COMPLETED" as const,
    fulfilmentType: "PICKUP_DELIVERY" as const,
    stageBeforeQuote: null,
    pickupWindowStatus: "CONFIRMED" as const,
    approvedQuoteId: "quote-2",
    quoteRevisions: [
      { version: 1, status: "PENDING" as const, approvedAt: null, declinedAt: null },
      { version: 2, status: "APPROVED" as const, approvedAt: at(2), declinedAt: null },
    ],
    // Out of order on purpose: the state sorts by time.
    statusEvents: [
      { id: "e4", fromStage: "OUT_FOR_DELIVERY" as const, toStage: "READY" as const, createdAt: at(4) },
      { id: "e1", fromStage: null, toStage: "PICKUP_SCHEDULED" as const, createdAt: at(1) },
      { id: "e5", fromStage: "READY" as const, toStage: "COMPLETED" as const, createdAt: at(5) },
      { id: "e3", fromStage: "READY" as const, toStage: "COMPLETED" as const, createdAt: at(3) },
    ],
  };

  it("takes the starting stage from the first event and the completion from the latest", () => {
    expect(getStageOrderState(record)).toEqual({
      stage: "COMPLETED",
      fulfilmentType: "PICKUP_DELIVERY",
      hasApprovedQuote: true,
      // Version 1 was an estimate, never sent.
      hasRevisionAwaitingApproval: false,
      startingStage: "PICKUP_SCHEDULED",
      completedFromStage: "READY",
      stageBeforeQuote: null,
      pickupWindowConfirmed: true,
    });
  });

  it("sees a sent revision waiting for approval", () => {
    const waiting = {
      ...record,
      quoteRevisions: [...record.quoteRevisions, { version: 3, status: "PENDING" as const, approvedAt: null, declinedAt: null }],
    };
    expect(getStageOrderState(waiting).hasRevisionAwaitingApproval).toBe(true);
  });
});
