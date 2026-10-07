import { describe, expect, it } from "vitest";

import { isPickupAvailable, type PickupAvailabilityInput } from "./pickup-schedule";

const READY: PickupAvailabilityInput = {
  pickupDeliveryEnabled: true,
  activeAreaCount: 2,
  activeDays: [1, 2, 3, 4, 5],
  openTime: "08:00",
  closeTime: "17:00",
};

describe("isPickupAvailable", () => {
  it("is false while pickup & delivery is off", () => {
    expect(isPickupAvailable({ ...READY, pickupDeliveryEnabled: false })).toBe(false);
  });

  it("is false when on without an active area", () => {
    expect(isPickupAvailable({ ...READY, activeAreaCount: 0 })).toBe(false);
  });

  it("is false when on without a valid schedule", () => {
    expect(isPickupAvailable({ ...READY, activeDays: [] })).toBe(false);
    expect(isPickupAvailable({ ...READY, openTime: null, closeTime: null })).toBe(false);
    expect(isPickupAvailable({ ...READY, openTime: "17:00", closeTime: "08:00" })).toBe(false);
  });

  it("is true when on with an area and a schedule", () => {
    expect(isPickupAvailable(READY)).toBe(true);
  });
});
