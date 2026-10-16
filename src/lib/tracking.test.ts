import { describe, expect, it } from "vitest";

import type { OrderStage } from "@/generated/prisma/enums";

import { getCustomerPaymentText, getCustomerStageLabel, getCustomerTimeline, type CustomerTimelineOrder } from "./tracking";

describe("getCustomerStageLabel", () => {
  it("uses the customer wording for every stage", () => {
    const expected: [OrderStage, string][] = [
      ["BOOKED", "Booking received"],
      ["PICKUP_SCHEDULED", "Pickup scheduled"],
      ["PICKED_UP", "Picked up"],
      ["RECEIVED_BY_STORE", "At the store"],
      ["QUOTE_AWAITING_APPROVAL", "Waiting for your approval"],
      ["IN_PROGRESS", "Being cleaned"],
      ["OUT_FOR_DELIVERY", "On its way"],
      ["COMPLETED", "Completed"],
      ["CANCELLED", "Cancelled"],
    ];
    for (const [stage, label] of expected) expect(getCustomerStageLabel(stage, "PICKUP_DELIVERY")).toBe(label);
  });

  it("says Ready for collection for drop-off, Ready for pickup orders", () => {
    expect(getCustomerStageLabel("READY", "DROP_OFF")).toBe("Ready for collection");
    expect(getCustomerStageLabel("READY", "PICKUP_DELIVERY")).toBe("Ready");
  });

  it("never uses internal words", () => {
    const stages: OrderStage[] = ["BOOKED", "QUOTE_AWAITING_APPROVAL", "RECEIVED_BY_STORE", "IN_PROGRESS", "READY"];
    for (const stage of stages) {
      expect(getCustomerStageLabel(stage, "DROP_OFF")).not.toMatch(/quote|revision|version|fulfilment/i);
    }
  });
});

describe("getCustomerPaymentText", () => {
  it("maps every payment state to plain words", () => {
    expect(getCustomerPaymentText({ state: "PAID", balanceKobo: 0 })).toBe("Paid");
    expect(getCustomerPaymentText({ state: "OUTSTANDING", balanceKobo: 250_000 })).toBe("Balance due: ₦2,500");
    expect(getCustomerPaymentText({ state: "REFUND_OWED", balanceKobo: -80_000 })).toBe("The store will refund ₦800");
    expect(getCustomerPaymentText({ state: "NOTHING_DUE", balanceKobo: 0 })).toBe("Nothing due");
    expect(getCustomerPaymentText({ state: "AWAITING_QUOTE", balanceKobo: null })).toBe("The store will confirm the price");
  });
});

describe("getCustomerTimeline", () => {
  const order = (overrides: Partial<CustomerTimelineOrder>): CustomerTimelineOrder => ({
    fulfilmentType: "PICKUP_DELIVERY",
    stage: "BOOKED",
    startingStage: "BOOKED",
    stageBeforeQuote: null,
    completedFromStage: null,
    cancelledFromStage: null,
    ...overrides,
  });
  const summary = (input: CustomerTimelineOrder) =>
    getCustomerTimeline(input).map((step) => `${{ done: "✓", current: "●", upcoming: "○" }[step.state]} ${step.label}`);

  it("shows every pickup stage, done, current, and upcoming", () => {
    expect(summary(order({ stage: "RECEIVED_BY_STORE" }))).toEqual([
      "✓ Booking received",
      "✓ Pickup scheduled",
      "✓ Picked up",
      "● At the store",
      "○ Being cleaned",
      "○ Ready",
      "○ On its way",
      "○ Completed",
    ]);
  });

  it("uses only the stages a drop-off order uses, from where it started", () => {
    expect(summary(order({ fulfilmentType: "DROP_OFF", stage: "IN_PROGRESS", startingStage: "RECEIVED_BY_STORE" }))).toEqual([
      "✓ At the store",
      "● Being cleaned",
      "○ Ready for collection",
      "○ Completed",
    ]);
    expect(summary(order({ fulfilmentType: "DROP_OFF", stage: "BOOKED" }))).toEqual([
      "● Booking received",
      "○ At the store",
      "○ Being cleaned",
      "○ Ready for collection",
      "○ Completed",
    ]);
  });

  it("starts a staff-entered pickup order at Pickup scheduled", () => {
    expect(summary(order({ stage: "PICKUP_SCHEDULED", startingStage: "PICKUP_SCHEDULED" }))[0]).toBe("● Pickup scheduled");
  });

  it("keeps the progress made while a price waits for approval", () => {
    expect(
      summary(order({ fulfilmentType: "DROP_OFF", stage: "QUOTE_AWAITING_APPROVAL", stageBeforeQuote: "RECEIVED_BY_STORE" })),
    ).toEqual(["✓ Booking received", "✓ At the store", "○ Being cleaned", "○ Ready for collection", "○ Completed"]);
    // A pickup charge sent before pickup: Booking received stays done.
    expect(summary(order({ stage: "QUOTE_AWAITING_APPROVAL", stageBeforeQuote: "BOOKED" })).slice(0, 2)).toEqual([
      "✓ Booking received",
      "○ Pickup scheduled",
    ]);
  });

  it("keeps Being cleaned current while a price update is reviewed during cleaning", () => {
    // A later price update doesn't move the order out of In progress.
    expect(summary(order({ fulfilmentType: "DROP_OFF", stage: "IN_PROGRESS" }))).toContain("● Being cleaned");
  });

  it("marks everything done once completed, skipping delivery when the customer collected", () => {
    expect(summary(order({ stage: "COMPLETED", completedFromStage: "OUT_FOR_DELIVERY" })).every((step) => step.startsWith("✓"))).toBe(
      true,
    );
    expect(summary(order({ stage: "COMPLETED", completedFromStage: "READY" }))).not.toContain("✓ On its way");
  });

  it("ends a cancelled order at Cancelled, after the steps it reached", () => {
    expect(summary(order({ stage: "CANCELLED", cancelledFromStage: "PICKUP_SCHEDULED" }))).toEqual([
      "✓ Booking received",
      "✓ Pickup scheduled",
      "● Cancelled",
    ]);
    expect(
      summary(order({ stage: "CANCELLED", cancelledFromStage: "QUOTE_AWAITING_APPROVAL", stageBeforeQuote: "BOOKED" })),
    ).toEqual(["✓ Booking received", "● Cancelled"]);
  });
});
