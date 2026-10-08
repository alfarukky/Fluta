import "server-only";

import { INVITATION_VALID_DAYS } from "@/schemas/staff";

// Staff invitations: a single-use private link. Tokens come from the shared
// helpers in src/lib/tokens.ts (only the hash is stored).

// Expired invitations stay in the staff list (with Resend) for this long.
export const EXPIRED_INVITATION_LISTED_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function getInvitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_VALID_DAYS * DAY_MS);
}

export function getInvitationUrl(token: string, baseUrl: string): string {
  return new URL(`/invite/${token}`, baseUrl).href;
}

export interface InvitationState {
  expiresAt: Date;
  acceptedAt: Date | null;
  // Revoked by the owner, or replaced by a newer invitation (Resend).
  revokedAt: Date | null;
}

export type InvitationStatus = "INVITED" | "EXPIRED" | "ACCEPTED" | "REVOKED";

export function getInvitationStatus(invitation: InvitationState, now: Date): InvitationStatus {
  if (invitation.acceptedAt) return "ACCEPTED";
  if (invitation.revokedAt) return "REVOKED";
  return invitation.expiresAt.getTime() > now.getTime() ? "INVITED" : "EXPIRED";
}

// Expired invitations whose expiry is after this are still listed.
export function getExpiredListingCutoff(now: Date): Date {
  return new Date(now.getTime() - EXPIRED_INVITATION_LISTED_DAYS * DAY_MS);
}

// The staff list shows pending invitations and those expired within 30 days.
// Revoked, replaced, and accepted ones are hidden (never deleted); an accepted
// invitation's person appears as a member instead.
export function isInvitationListed(invitation: InvitationState, now: Date): boolean {
  const status = getInvitationStatus(invitation, now);
  if (status === "INVITED") return true;
  return status === "EXPIRED" && invitation.expiresAt.getTime() > getExpiredListingCutoff(now).getTime();
}
