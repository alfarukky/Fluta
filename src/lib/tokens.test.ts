import { describe, expect, it } from "vitest";

import { generateToken, getTrackingLinkStatus, hashToken, isWellFormedToken, type TrackingLinkOrder } from "./tokens";

describe("tokens", () => {
  it("are random 256-bit base64url strings", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      expect(isWellFormedToken(token)).toBe(true);
    }
  });

  it("are stored as a SHA-256 hex hash that differs from the token", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(generateToken())).not.toBe(hash);
  });

  it("matches a known SHA-256 value", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("refuses text that can't be a token", () => {
    for (const text of ["", "short", "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`]) {
      expect(isWellFormedToken(text)).toBe(false);
    }
  });
});

describe("getTrackingLinkStatus", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const order = (overrides: Partial<TrackingLinkOrder> = {}): TrackingLinkOrder => ({
    storeStatus: "ACTIVE",
    stage: "IN_PROGRESS",
    completedAt: null,
    cancelledAt: null,
    paymentState: "OUTSTANDING",
    ...overrides,
  });

  it("shows nothing for a Deactivated store, before anything else", () => {
    expect(getTrackingLinkStatus(order({ storeStatus: "DEACTIVATED" }), now)).toBe("STORE_DEACTIVATED");
    expect(getTrackingLinkStatus(order({ storeStatus: "DEACTIVATED", paymentState: "REFUND_OWED" }), now)).toBe(
      "STORE_DEACTIVATED",
    );
  });

  it("works for an open order, however old, and for a Paused store", () => {
    expect(getTrackingLinkStatus(order(), now)).toBe("VALID");
    expect(getTrackingLinkStatus(order({ stage: "BOOKED", storeStatus: "PAUSED" }), now)).toBe("VALID");
  });

  it("works for 30 days after the order was completed or cancelled", () => {
    expect(getTrackingLinkStatus(order({ stage: "COMPLETED", completedAt: daysAgo(29.9), paymentState: "PAID" }), now)).toBe("VALID");
    expect(getTrackingLinkStatus(order({ stage: "CANCELLED", cancelledAt: daysAgo(1), paymentState: "NOTHING_DUE" }), now)).toBe(
      "VALID",
    );
    expect(getTrackingLinkStatus(order({ stage: "COMPLETED", completedAt: daysAgo(30), paymentState: "PAID" }), now)).toBe("EXPIRED");
    expect(getTrackingLinkStatus(order({ stage: "CANCELLED", cancelledAt: daysAgo(45), paymentState: "NOTHING_DUE" }), now)).toBe(
      "EXPIRED",
    );
  });

  it("keeps working after 30 days while a refund is owed", () => {
    expect(getTrackingLinkStatus(order({ stage: "CANCELLED", cancelledAt: daysAgo(90), paymentState: "REFUND_OWED" }), now)).toBe(
      "VALID",
    );
    expect(getTrackingLinkStatus(order({ stage: "COMPLETED", completedAt: daysAgo(60), paymentState: "REFUND_OWED" }), now)).toBe(
      "VALID",
    );
  });

  it("expires a closed order with no closing time and nothing owed", () => {
    expect(getTrackingLinkStatus(order({ stage: "COMPLETED", completedAt: null, paymentState: "PAID" }), now)).toBe("EXPIRED");
  });

  it("uses the closing time of the order's own stage", () => {
    // Reopened after completion and then cancelled: the cancellation counts.
    expect(
      getTrackingLinkStatus(order({ stage: "CANCELLED", completedAt: daysAgo(60), cancelledAt: daysAgo(2), paymentState: "NOTHING_DUE" }), now),
    ).toBe("VALID");
  });
});
