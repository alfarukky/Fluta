import { describe, expect, it } from "vitest";

import { getInvitationExpiry, getInvitationStatus, getInvitationUrl, isInvitationListed } from "./invitations";

const NOW = new Date("2026-10-08T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

const pending = { expiresAt: daysFromNow(7), acceptedAt: null, revokedAt: null };

describe("invitation links", () => {
  it("expire after 7 days and link to /invite/<token>", () => {
    expect(getInvitationExpiry(NOW)).toEqual(daysFromNow(7));
    expect(getInvitationUrl("tok", "http://localhost:3000")).toBe("http://localhost:3000/invite/tok");
  });
});

describe("getInvitationStatus", () => {
  it("is Invited until it expires", () => {
    expect(getInvitationStatus(pending, NOW)).toBe("INVITED");
    expect(getInvitationStatus({ ...pending, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe("INVITED");
  });

  it("is expired from its expiry time", () => {
    expect(getInvitationStatus({ ...pending, expiresAt: NOW }, NOW)).toBe("EXPIRED");
    expect(getInvitationStatus({ ...pending, expiresAt: daysFromNow(-1) }, NOW)).toBe("EXPIRED");
  });

  it("is accepted or revoked whatever the expiry", () => {
    expect(getInvitationStatus({ ...pending, acceptedAt: daysFromNow(-1) }, NOW)).toBe("ACCEPTED");
    expect(getInvitationStatus({ ...pending, expiresAt: daysFromNow(-3), acceptedAt: daysFromNow(-5) }, NOW)).toBe(
      "ACCEPTED",
    );
    expect(getInvitationStatus({ ...pending, revokedAt: daysFromNow(-1) }, NOW)).toBe("REVOKED");
    expect(getInvitationStatus({ ...pending, expiresAt: daysFromNow(-3), revokedAt: daysFromNow(-1) }, NOW)).toBe(
      "REVOKED",
    );
  });
});

describe("isInvitationListed", () => {
  it("lists pending invitations and those expired within 30 days", () => {
    expect(isInvitationListed(pending, NOW)).toBe(true);
    expect(isInvitationListed({ ...pending, expiresAt: daysFromNow(-1) }, NOW)).toBe(true);
    expect(isInvitationListed({ ...pending, expiresAt: daysFromNow(-29) }, NOW)).toBe(true);
  });

  it("hides revoked, replaced, accepted, and long-expired invitations", () => {
    expect(isInvitationListed({ ...pending, revokedAt: daysFromNow(-1) }, NOW)).toBe(false);
    expect(isInvitationListed({ ...pending, acceptedAt: daysFromNow(-1) }, NOW)).toBe(false);
    expect(isInvitationListed({ ...pending, expiresAt: daysFromNow(-30) }, NOW)).toBe(false);
    expect(isInvitationListed({ ...pending, expiresAt: daysFromNow(-45) }, NOW)).toBe(false);
  });
});
