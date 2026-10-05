import { describe, expect, it } from "vitest";

import type { StoreAccess } from "@/server/domain/store-access";

import { summarizeStoreStatus } from "./store-status";

function access(subscriptionStatus: StoreAccess["subscriptionStatus"], canAcceptNewOrders: boolean): StoreAccess {
  return {
    subscriptionStatus,
    canAcceptNewOrders,
    canWorkOnExistingOrders: true,
    canEditSettings: true,
    canUseTrackingLinks: true,
  };
}

describe("summarizeStoreStatus", () => {
  it("shows an active store as Active to everyone", () => {
    for (const role of ["OWNER", "STAFF"] as const) {
      expect(summarizeStoreStatus("ACTIVE", access("ACTIVE", true), role)).toMatchObject({
        label: "Active",
        variant: "success",
      });
    }
  });

  it("shows an overdue subscription as Overdue to owners only", () => {
    expect(summarizeStoreStatus("ACTIVE", access("OVERDUE", true), "OWNER")).toMatchObject({
      label: "Overdue",
      variant: "warning",
    });
    expect(summarizeStoreStatus("ACTIVE", access("OVERDUE", true), "STAFF")).toMatchObject({
      label: "Active",
      variant: "success",
    });
  });

  it("shows a suspended (or missing) subscription as Suspended to owners and as not taking bookings to staff", () => {
    expect(summarizeStoreStatus("ACTIVE", access("SUSPENDED", false), "OWNER")).toMatchObject({
      label: "Suspended",
      variant: "error",
    });
    expect(summarizeStoreStatus("ACTIVE", access("SUSPENDED", false), "STAFF")).toMatchObject({
      label: "Not taking new bookings",
      variant: "error",
    });
  });

  it("shows the most restrictive status: Paused, then Suspended, then Overdue", () => {
    for (const role of ["OWNER", "STAFF"] as const) {
      for (const status of ["ACTIVE", "OVERDUE", "SUSPENDED"] as const) {
        expect(summarizeStoreStatus("PAUSED", access(status, false), role)).toMatchObject({ label: "Paused" });
      }
    }
  });
});
