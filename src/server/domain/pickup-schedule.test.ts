import { describe, expect, it } from "vitest";

import { isPickupAvailable, type PickupAvailabilityInput } from "./pickup-schedule";

const READY: PickupAvailabilityInput = {
  pickupDeliveryEnabled: true,
  activeAreaCount: 2,
  defaultDeliveryFee: null,
  activeDays: [1, 2, 3, 4, 5],
  openTime: "08:00",
  closeTime: "17:00",
};

describe("isPickupAvailable", () => {
  it("is false while pickup & delivery is off", () => {
    expect(isPickupAvailable({ ...READY, pickupDeliveryEnabled: false })).toBe(false);
  });

  it("is false when on with neither an active area nor a default fee", () => {
    expect(isPickupAvailable({ ...READY, activeAreaCount: 0 })).toBe(false);
  });

  it("is true with only a default fee, ₦0 included", () => {
    expect(isPickupAvailable({ ...READY, activeAreaCount: 0, defaultDeliveryFee: 150_000 })).toBe(true);
    expect(isPickupAvailable({ ...READY, activeAreaCount: 0, defaultDeliveryFee: 0 })).toBe(true);
  });

  it("never lets a default fee get around the other rules", () => {
    const feeOnly = { ...READY, activeAreaCount: 0, defaultDeliveryFee: 0 };
    expect(isPickupAvailable({ ...feeOnly, pickupDeliveryEnabled: false })).toBe(false);
    expect(isPickupAvailable({ ...feeOnly, activeDays: [] })).toBe(false);
  });

  it("is false when on without a valid schedule", () => {
    expect(isPickupAvailable({ ...READY, activeDays: [] })).toBe(false);
    expect(isPickupAvailable({ ...READY, openTime: null, closeTime: null })).toBe(false);
    expect(isPickupAvailable({ ...READY, openTime: "17:00", closeTime: "08:00" })).toBe(false);
  });

  it("is true when on with an active area and a schedule", () => {
    expect(isPickupAvailable(READY)).toBe(true);
    expect(isPickupAvailable({ ...READY, defaultDeliveryFee: 50_000 })).toBe(true);
  });
});
