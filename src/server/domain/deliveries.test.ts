import { describe, expect, it } from "vitest";

import { getLocalDateKey } from "@/lib/time";

import { buildDeliverySections, type DeliveryOrder } from "./deliveries";

const STORE = { orderPrefix: "FF" };
const TODAY = "2026-10-16";

let nextNumber = 1000;
function order(overrides: Partial<DeliveryOrder> = {}): DeliveryOrder {
  const number = nextNumber++;
  return {
    id: `order-${number}`,
    orderNumber: number,
    stage: "PICKUP_SCHEDULED",
    addressText: "12 Admiralty Way, Lekki",
    serviceAreaName: "Lekki Phase 1",
    isOutOfArea: false,
    scheduledPickupDate: new Date(`${TODAY}T00:00:00Z`),
    scheduledWindowStart: "10:00",
    scheduledWindowEnd: "12:00",
    isOutsideSchedule: false,
    customer: { name: "Tolu Bakare", phone: "+2348031234521" },
    ...overrides,
  };
}

describe("buildDeliverySections", () => {
  it("puts each stage in its section", () => {
    const pickup = order();
    const out = order({ stage: "OUT_FOR_DELIVERY", scheduledPickupDate: null });
    const ready = order({ stage: "READY", scheduledPickupDate: null });
    const sections = buildDeliverySections([ready, out, pickup], TODAY, STORE);
    expect(sections.pickups.map((card) => card.orderId)).toEqual([pickup.id]);
    expect(sections.onTheWay.map((card) => card.orderId)).toEqual([out.id]);
    expect(sections.readyToDeliver.map((card) => card.orderId)).toEqual([ready.id]);
  });

  it("leaves out picked-up orders and every other stage", () => {
    const stages = ["BOOKED", "PICKED_UP", "RECEIVED_BY_STORE", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
    const sections = buildDeliverySections(
      stages.map((stage) => order({ stage })),
      TODAY,
      STORE,
    );
    expect(sections).toEqual({ pickups: [], onTheWay: [], readyToDeliver: [] });
  });

  it("shows pickups for today or earlier, never later", () => {
    const tomorrow = order({ scheduledPickupDate: new Date("2026-10-17T00:00:00Z") });
    const yesterday = order({ scheduledPickupDate: new Date("2026-10-15T00:00:00Z") });
    const { pickups } = buildDeliverySections([tomorrow, yesterday], TODAY, STORE);
    expect(pickups.map((card) => card.orderId)).toEqual([yesterday.id]);
    expect(pickups[0].isOverdue).toBe(true);
  });

  it("sorts overdue pickups first (oldest first), then by window start", () => {
    const late = order({ scheduledWindowStart: "16:00", scheduledWindowEnd: "18:00" });
    const early = order({ scheduledWindowStart: "08:00", scheduledWindowEnd: "10:00" });
    const overdue = order({ scheduledPickupDate: new Date("2026-10-15T00:00:00Z"), scheduledWindowStart: "18:00" });
    const older = order({ scheduledPickupDate: new Date("2026-10-13T00:00:00Z"), scheduledWindowStart: "20:00" });
    const { pickups } = buildDeliverySections([late, overdue, early, older], TODAY, STORE);
    expect(pickups.map((card) => [card.orderId, card.isOverdue])).toEqual([
      [older.id, true],
      [overdue.id, true],
      [early.id, false],
      [late.id, false],
    ]);
  });

  it("builds pickup cards with only the fields they show", () => {
    const pickup = order({ orderNumber: 1042, isOutsideSchedule: true, isOutOfArea: true, serviceAreaName: "Ajah" });
    const [card] = buildDeliverySections([pickup], TODAY, STORE).pickups;
    expect(card).toEqual({
      orderId: pickup.id,
      orderNumber: "FF-1042",
      customerName: "Tolu Bakare",
      customerPhone: "+2348031234521",
      address: "12 Admiralty Way, Lekki",
      areaName: "Ajah",
      isOutOfArea: true,
      stage: "PICKUP_SCHEDULED",
      scheduledDate: TODAY,
      windowStart: "10:00",
      windowEnd: "12:00",
      isOutsideSchedule: true,
      isOverdue: false,
    });
  });

  it("gives delivery cards no time", () => {
    const ready = order({ stage: "READY", orderNumber: 1043 });
    const [card] = buildDeliverySections([ready], TODAY, STORE).readyToDeliver;
    expect(Object.keys(card).sort()).toEqual(
      ["address", "areaName", "customerName", "customerPhone", "isOutOfArea", "orderId", "orderNumber", "stage"].sort(),
    );
  });
});

describe("today in the store's time zone", () => {
  // 23:30 UTC on 15 October is 00:30 on 16 October in Lagos (UTC+1).
  const now = new Date("2026-10-15T23:30:00Z");

  it("uses the store's date, not the server's", () => {
    expect(getLocalDateKey(now, "Africa/Lagos")).toBe("2026-10-16");
    expect(getLocalDateKey(now, "UTC")).toBe("2026-10-15");
  });

  it("shows a pickup for the store's today just after its midnight", () => {
    const pickup = order({ scheduledPickupDate: new Date("2026-10-16T00:00:00Z") });
    const lagos = buildDeliverySections([pickup], getLocalDateKey(now, "Africa/Lagos"), STORE);
    expect(lagos.pickups.map((card) => [card.orderId, card.isOverdue])).toEqual([[pickup.id, false]]);
    expect(buildDeliverySections([pickup], getLocalDateKey(now, "UTC"), STORE).pickups).toEqual([]);
  });
});
