import { describe, expect, it } from "vitest";

import {
  checkOwnerCanEdit,
  checkStoreMember,
  ownerEditRefusalMessage,
  STORE_LOCKED_MESSAGE,
  type StoreMembershipLookup,
} from "./access";

const NOW = new Date("2026-10-05T10:00:00Z");

function lookupFor(
  role: "OWNER" | "STAFF",
  storeStatus: "ACTIVE" | "PAUSED" | "DEACTIVATED" = "ACTIVE",
  cancelledAt: Date | null = null,
): StoreMembershipLookup {
  return {
    found: true,
    user: {
      id: "user-1",
      name: "Kemi Adeyemi",
      email: "kemi@freshfold.example",
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
    membership: {
      id: "membership-1",
      role,
      store: {
        id: "store-1",
        name: "FreshFold Laundry",
        slug: "freshfold-laundry",
        status: storeStatus,
        timeZone: "Africa/Lagos",
        brandPrimaryColor: null,
        subscription: { cancelledAt, graceDays: 7, invoices: [] },
      },
    },
  };
}

// requireStoreMember shares one lookup per request; the role and store-access
// checks must still run for every caller.
describe("checkStoreMember", () => {
  it("applies each caller's required role to the same lookup", () => {
    const staff = lookupFor("STAFF");
    expect(checkStoreMember(staff, {}, NOW)).toMatchObject({ allowed: true, membership: { role: "STAFF" } });
    expect(checkStoreMember(staff, { role: "OWNER" }, NOW)).toMatchObject({
      allowed: false,
      status: 403,
      reason: "ROLE_NOT_PERMITTED",
    });
    expect(checkStoreMember(lookupFor("OWNER"), { role: "OWNER" }, NOW)).toMatchObject({ allowed: true });
  });

  it("turns a failed lookup into 401 or 403", () => {
    expect(checkStoreMember({ found: false, reason: "UNAUTHENTICATED" }, {}, NOW)).toMatchObject({ status: 401 });
    expect(checkStoreMember({ found: false, reason: "NO_ACTIVE_MEMBERSHIP" }, {}, NOW)).toMatchObject({
      status: 403,
      reason: "NO_ACTIVE_MEMBERSHIP",
    });
  });

  it("refuses a deactivated store", () => {
    expect(checkStoreMember(lookupFor("OWNER", "DEACTIVATED"), {}, NOW)).toMatchObject({
      allowed: false,
      reason: "STORE_UNAVAILABLE",
    });
  });

  it("returns the store without its subscription, plus its access", () => {
    const result = checkStoreMember(lookupFor("STAFF"), {}, NOW);
    expect(result).toMatchObject({ allowed: true, access: { subscriptionStatus: "ACTIVE" } });
    expect(result.allowed && "subscription" in result.store).toBe(false);
  });
});

// Every owner editing operation: owner role plus getStoreAccess()'s
// canEditSettings (store Active or Paused, subscription not Cancelled).
describe("checkOwnerCanEdit", () => {
  it("allows the owner of an active or paused store", () => {
    expect(checkOwnerCanEdit(lookupFor("OWNER"), NOW)).toMatchObject({ allowed: true });
    expect(checkOwnerCanEdit(lookupFor("OWNER", "PAUSED"), NOW)).toMatchObject({ allowed: true });
  });

  it("refuses staff", () => {
    expect(checkOwnerCanEdit(lookupFor("STAFF"), NOW)).toMatchObject({ allowed: false, reason: "ROLE_NOT_PERMITTED" });
  });

  it("refuses a cancelled subscription or a deactivated store with 403", () => {
    for (const lookup of [lookupFor("OWNER", "ACTIVE", NOW), lookupFor("OWNER", "DEACTIVATED")]) {
      const result = checkOwnerCanEdit(lookup, NOW);
      expect(result).toMatchObject({ allowed: false, status: 403 });
      expect(!result.allowed && ownerEditRefusalMessage(result, "not owner")).toBe(STORE_LOCKED_MESSAGE);
    }
  });

  it("explains each refusal", () => {
    expect(ownerEditRefusalMessage({ allowed: false, status: 403, reason: "ROLE_NOT_PERMITTED" }, "not owner")).toBe(
      "not owner",
    );
    expect(
      ownerEditRefusalMessage({ allowed: false, status: 403, reason: "EDITING_NOT_ALLOWED" }, "not owner"),
    ).toBe(STORE_LOCKED_MESSAGE);
    expect(ownerEditRefusalMessage({ allowed: false, status: 401, reason: "UNAUTHENTICATED" }, "not owner")).toBe(
      "Sign in again to continue.",
    );
  });
});
