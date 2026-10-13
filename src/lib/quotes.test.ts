import { describe, expect, it } from "vitest";

import {
  canReviseQuote,
  describeRevisionMoment,
  findDeclinedRevision,
  findPendingRevision,
  formatDifference,
  getTotalDifference,
  isRevisionReasonRequired,
} from "./quotes";

const revision = (version: number, status: "PENDING" | "APPROVED" | "DECLINED" | "SUPERSEDED", decided = status !== "PENDING") => ({
  id: `v${version}`,
  version,
  status,
  approvedAt: decided && status !== "DECLINED" ? new Date() : null,
  declinedAt: status === "DECLINED" ? new Date() : null,
});

describe("the difference shown", () => {
  it("is the new total minus the last approved one", () => {
    expect(getTotalDifference(1_000_000, 1_250_000)).toBe(250_000);
    expect(getTotalDifference(1_000_000, 900_000)).toBe(-100_000);
    expect(getTotalDifference(null, 900_000)).toBeNull();
  });

  it("reads with a sign", () => {
    expect(formatDifference(250_000)).toBe("+₦2,500");
    expect(formatDifference(-50_050)).toBe("−₦500.50");
    expect(formatDifference(0)).toBe("No change");
  });
});

describe("rules", () => {
  it("requires a reason only after the first approved quote", () => {
    expect(isRevisionReasonRequired(false)).toBe(false);
    expect(isRevisionReasonRequired(true)).toBe(true);
  });

  it("allows revisions up to Ready", () => {
    expect(canReviseQuote("READY")).toBe(true);
    expect(canReviseQuote("QUOTE_AWAITING_APPROVAL")).toBe(true);
    expect(canReviseQuote("OUT_FOR_DELIVERY")).toBe(false);
    expect(canReviseQuote("COMPLETED")).toBe(false);
    expect(canReviseQuote("CANCELLED")).toBe(false);
  });
});

describe("finding revisions", () => {
  it("finds the revision awaiting approval, never an estimate", () => {
    expect(findPendingRevision([revision(1, "PENDING")])).toBeNull();
    expect(findPendingRevision([revision(1, "SUPERSEDED"), revision(2, "PENDING")])?.id).toBe("v2");
  });

  it("finds a decline only while it is the newest revision", () => {
    expect(findDeclinedRevision([revision(1, "APPROVED"), revision(2, "DECLINED")])?.id).toBe("v2");
    expect(findDeclinedRevision([revision(1, "APPROVED"), revision(2, "DECLINED"), revision(3, "PENDING")])).toBeNull();
  });
});

describe("describeRevisionMoment", () => {
  const base = { version: 2, total: 1_250_000, difference: 250_000, customerMessage: null, decidedBy: null };

  it("words each moment", () => {
    expect(describeRevisionMoment({ ...base, moment: "ISSUED" }, "Ada")).toBe("Quote v2 issued: ₦12,500 (+₦2,500)");
    expect(describeRevisionMoment({ ...base, moment: "ISSUED", difference: null }, null)).toBe("Quote v2 issued: ₦12,500");
    expect(describeRevisionMoment({ ...base, moment: "APPROVED", decidedBy: "STAFF" }, "Ada")).toBe(
      "Quote v2 approved by customer (recorded by Ada)",
    );
    expect(describeRevisionMoment({ ...base, moment: "APPROVED", decidedBy: "CUSTOMER" }, null)).toBe("Quote v2 approved by customer");
    expect(
      describeRevisionMoment({ ...base, version: 3, moment: "DECLINED", customerMessage: "Too expensive", decidedBy: "CUSTOMER" }, null),
    ).toBe("Quote v3 declined: Too expensive");
  });
});
