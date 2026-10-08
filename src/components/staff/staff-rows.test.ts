import { describe, expect, it } from "vitest";

import { applyStaffChanges, countStaff, NO_STAFF_CHANGES, type StaffRow } from "./staff-rows";

const owner: StaffRow = { kind: "member", id: "m-owner", name: "Ada", email: "ada@x.example", role: "OWNER", status: "ACTIVE", dateLabel: "" };
const staff: StaffRow = { kind: "member", id: "m-staff", name: "Kemi", email: "kemi@x.example", role: "STAFF", status: "ACTIVE", dateLabel: "" };
const invite: StaffRow = { kind: "invitation", id: "i-1", name: null, email: "new@x.example", role: "STAFF", status: "INVITE_EXPIRED", dateLabel: "" };
const rows = [owner, staff, invite];

describe("applyStaffChanges", () => {
  it("leaves the rows unchanged without changes", () => {
    expect(applyStaffChanges(rows, NO_STAFF_CHANGES)).toEqual(rows);
  });

  it("swaps a resent invitation for its replacement, pending again, following repeated resends", () => {
    const changes = { ...NO_STAFF_CHANGES, replaced: new Map([["i-1", "i-2"], ["i-2", "i-3"]]) };
    expect(applyStaffChanges(rows, changes)[2]).toEqual({ ...invite, id: "i-3", status: "INVITED" });
  });

  it("hides a revoked invitation, including one revoked straight after Resend", () => {
    expect(applyStaffChanges(rows, { ...NO_STAFF_CHANGES, revoked: new Set(["i-1"]) })).toEqual([owner, staff]);
    const resentThenRevoked = { ...NO_STAFF_CHANGES, replaced: new Map([["i-1", "i-2"]]), revoked: new Set(["i-2"]) };
    expect(applyStaffChanges(rows, resentThenRevoked)).toEqual([owner, staff]);
  });

  it("shows a member's new status", () => {
    const changes = { ...NO_STAFF_CHANGES, statuses: new Map([["m-staff", "DEACTIVATED" as const]]) };
    expect(applyStaffChanges(rows, changes)[1]).toEqual({ ...staff, status: "DEACTIVATED" });
  });
});

describe("countStaff", () => {
  it("counts everyone but owners", () => {
    expect(countStaff(rows)).toBe(2);
    expect(countStaff([owner])).toBe(0);
  });
});
