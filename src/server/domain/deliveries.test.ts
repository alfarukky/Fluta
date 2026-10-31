import { describe, expect, it } from "vitest";

import { getLocalDateKey } from "@/lib/time";

import {
  buildComingUp,
  buildDeliverySections,
  comingUpWording,
  getComingUpRange,
  type ComingUpInput,
  type ComingUpPickupRecord,
  type DeliveryOrder,
} from "./deliveries";

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
    pickupLatitude: null,
    pickupLongitude: null,
    scheduledPickupDate: new Date(`${TODAY}T00:00:00Z`),
    scheduledWindowStart: "10:00",
    scheduledWindowEnd: "12:00",
    isOutsideSchedule: false,
    customer: { name: "Tolu Bakare", phone: "+2348031234521" },
    ...overrides,
  };
}

describe("buildDeliverySections", () => {
  it("gives each card the shared location as numbers, or none", () => {
    const shared = order({ pickupLatitude: "6.428123", pickupLongitude: "3.421988" });
    const none = order({ stage: "READY", scheduledPickupDate: null });
    const sections = buildDeliverySections([shared, none], TODAY, STORE);
    expect(sections.pickups[0].location).toEqual({ latitude: 6.428123, longitude: 3.421988 });
    expect(sections.readyToDeliver[0].location).toBeNull();
  });

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
      location: null,
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
      ["address", "areaName", "customerName", "customerPhone", "isOutOfArea", "location", "orderId", "orderNumber", "stage"].sort(),
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

describe("Coming up", () => {
  // TODAY is Fri 16 Oct 2026.
  function pickup(date: string, window: [string, string] | null = ["10:00", "12:00"], area: string | null = "Wuse"): ComingUpPickupRecord {
    return {
      scheduledPickupDate: new Date(`${date}T00:00:00Z`),
      scheduledWindowStart: window?.[0] ?? null,
      scheduledWindowEnd: window?.[1] ?? null,
      serviceAreaName: area,
    };
  }
  const input = (overrides: Partial<ComingUpInput> = {}): ComingUpInput => ({
    pickups: [],
    waitingCount: 0,
    cleaningCount: 0,
    ...overrides,
  });

  it("covers tomorrow through the 7th day, in calendar days", () => {
    expect(getComingUpRange(TODAY)).toEqual({ firstDayKey: "2026-10-17", lastDayKey: "2026-10-23" });
    expect(getComingUpRange("2026-12-28")).toEqual({ firstDayKey: "2026-12-29", lastDayKey: "2027-01-04" });
  });

  it("groups confirmed pickups by day, labels tomorrow, leaves out empty days, and sorts by window start", () => {
    const comingUp = buildComingUp(
      input({
        pickups: [
          pickup("2026-10-19", ["14:00", "16:00"], "Garki"),
          pickup("2026-10-17", ["14:00", "16:00"], "Maitama"),
          pickup("2026-10-17", ["08:00", "10:00"], "Wuse"),
          pickup("2026-10-17", ["10:00", "12:00"], null),
        ],
      }),
      TODAY,
    );
    expect(comingUp.days).toEqual([
      {
        date: "2026-10-17",
        heading: "Tomorrow, Sat 17 Oct · 3 pickups",
        pickups: ["8:00 AM – 10:00 AM · Wuse", "10:00 AM – 12:00 PM · Outside our service areas", "2:00 PM – 4:00 PM · Maitama"],
      },
      { date: "2026-10-19", heading: "Mon 19 Oct · 1 pickup", pickups: ["2:00 PM – 4:00 PM · Garki"] },
    ]);
    expect(comingUp.empty).toBe(false);
  });

  it("shows only the area when a pickup has no window", () => {
    expect(buildComingUp(input({ pickups: [pickup("2026-10-18", null)] }), TODAY).days[0].pickups).toEqual(["Wuse"]);
  });

  it("never includes today, and stops after the 7th day", () => {
    const comingUp = buildComingUp(
      input({
        pickups: [
          pickup("2026-10-15"),
          pickup(TODAY),
          pickup("2026-10-17"),
          pickup("2026-10-23"),
          pickup("2026-10-24"),
          { ...pickup("2026-10-18"), scheduledPickupDate: null },
        ],
      }),
      TODAY,
    );
    expect(comingUp.days.map((day) => day.date)).toEqual(["2026-10-17", "2026-10-23"]);
  });

  it("works out the days in the store's time zone", () => {
    // 23:30 on Fri 16 Oct in Lagos is already Saturday in UTC+2 and later zones.
    const now = new Date("2026-10-16T22:30:00Z");
    const lagosToday = getLocalDateKey(now, "Africa/Lagos");
    expect(lagosToday).toBe(TODAY);
    const comingUp = buildComingUp(input({ pickups: [pickup(TODAY), pickup("2026-10-17"), pickup("2026-10-24")] }), lagosToday);
    expect(comingUp.days.map((day) => day.heading)).toEqual(["Tomorrow, Sat 17 Oct · 1 pickup"]);
  });

  it("words the waiting and being-cleaned counts, singular and plural", () => {
    expect(buildComingUp(input({ waitingCount: 1, cleaningCount: 1 }), TODAY)).toMatchObject({
      waiting: "1 more pickup is waiting for the store to confirm a time.",
      cleaning: "1 order is being cleaned and will need delivery.",
    });
    expect(buildComingUp(input({ waitingCount: 2, cleaningCount: 4 }), TODAY)).toMatchObject({
      waiting: "2 more pickups are waiting for the store to confirm a time.",
      cleaning: "4 orders are being cleaned and will need delivery.",
    });
    expect(comingUpWording.pickupCount(1)).toBe("1 pickup");
    expect(comingUpWording.pickupCount(3)).toBe("3 pickups");
  });

  it("is empty only when there are no pickups and both counts are zero", () => {
    expect(buildComingUp(input(), TODAY)).toEqual({ days: [], waiting: null, cleaning: null, empty: true });
    expect(buildComingUp(input({ pickups: [pickup("2026-10-17")] }), TODAY).empty).toBe(false);
    expect(buildComingUp(input({ waitingCount: 1 }), TODAY)).toMatchObject({ days: [], cleaning: null, empty: false });
    expect(buildComingUp(input({ cleaningCount: 1 }), TODAY)).toMatchObject({ days: [], waiting: null, empty: false });
    // Pickups only outside the 7 days don't count.
    expect(buildComingUp(input({ pickups: [pickup(TODAY), pickup("2026-10-24")] }), TODAY).empty).toBe(true);
  });
});
