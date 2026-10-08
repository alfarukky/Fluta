import "server-only";

import { getServerEnv } from "@/lib/env";
import { getAuth } from "@/server/auth/auth";
import {
  createStaffInvitation,
  listOpenInvitations,
  replaceStaffInvitation,
  revokeStaffInvitation,
} from "@/server/data/invitations";
import { deactivateStaffMembership, listStoreMembers, reactivateStaff as reactivate } from "@/server/data/staff";
import { getExpiredListingCutoff, getInvitationExpiry, getInvitationStatus, getInvitationUrl } from "@/server/domain/invitations";
import { generateToken, hashToken } from "@/lib/tokens";
import type { StaffListEntry } from "@/types/staff";

import { buildInvitationEmail, trySendEmail } from "./emails";

// Staff management for the owner's own store. Every function takes the store
// from the caller's membership (src/actions/staff.ts), never from the request.

export interface Inviter {
  storeId: string;
  storeName: string;
  timeZone: string;
  userId: string;
  userName: string;
}

// The link is returned to the owner once (Copy link), whether or not the
// email went out: sending happens after the invitation is saved and never
// undoes it.
export type InvitationSent = { ok: true; invitationId: string; inviteUrl: string; emailSent: boolean };

export type InviteResult =
  | InvitationSent
  | { ok: false; code: "EMAIL_IN_USE" }
  | { ok: false; code: "PENDING_INVITATION_EXISTS"; invitationId: string };

export async function inviteStaff(inviter: Inviter, email: string, now = new Date()): Promise<InviteResult> {
  const token = generateToken();
  const expiresAt = getInvitationExpiry(now);
  const result = await createStaffInvitation(
    inviter.storeId,
    email,
    { tokenHash: hashToken(token), invitedByUserId: inviter.userId, expiresAt },
    now,
  );
  if (!result.ok) return result;
  return sendInvitation(inviter, result.invitationId, result.email, token, expiresAt);
}

export type ResendResult = InvitationSent | { ok: false; code: "NOT_FOUND" | "EMAIL_IN_USE" };

export async function resendInvitation(inviter: Inviter, invitationId: string, now = new Date()): Promise<ResendResult> {
  const token = generateToken();
  const expiresAt = getInvitationExpiry(now);
  const result = await replaceStaffInvitation(
    inviter.storeId,
    invitationId,
    { tokenHash: hashToken(token), invitedByUserId: inviter.userId, expiresAt },
    now,
  );
  if (!result.ok) return result;
  return sendInvitation(inviter, result.invitationId, result.email, token, expiresAt);
}

export async function revokeInvitation(storeId: string, invitationId: string, now = new Date()): Promise<boolean> {
  return revokeStaffInvitation(storeId, invitationId, now);
}

export type StaffChangeResult = { ok: true } | { ok: false; code: "NOT_FOUND" | "ACTIVE_MEMBERSHIP_EXISTS" };

// Deactivates, then signs the person out everywhere by deleting all their
// sessions through Better Auth. Even if that fails, their next request is
// refused: the membership is checked on every request.
export async function deactivateStaff(
  storeId: string,
  membershipId: string,
  actorUserId: string,
  now = new Date(),
): Promise<StaffChangeResult> {
  const result = await deactivateStaffMembership(storeId, membershipId, actorUserId, now);
  if (!result.ok) return result;

  try {
    const context = await getAuth().$context;
    await context.internalAdapter.deleteUserSessions(result.userId);
  } catch (error) {
    console.error(
      `[staff] revoking sessions for user ${result.userId} failed:`,
      error instanceof Error ? error.name : "unknown error",
    );
  }
  return { ok: true };
}

export async function reactivateStaff(
  storeId: string,
  membershipId: string,
  actorUserId: string,
): Promise<StaffChangeResult> {
  const result = await reactivate(storeId, membershipId, actorUserId);
  return result.ok ? { ok: true } : result;
}

// Members (owners first), then open invitations: pending, and expired within
// the last 30 days. Revoked, replaced, and accepted invitations are hidden.
export async function getStaffList(storeId: string, now = new Date()): Promise<StaffListEntry[]> {
  const [members, invitations] = await Promise.all([
    listStoreMembers(storeId),
    listOpenInvitations(storeId, getExpiredListingCutoff(now)),
  ]);

  return [
    ...members.map(
      (member): StaffListEntry => ({
        kind: "member",
        id: member.id,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
        status: member.isActive ? "ACTIVE" : "DEACTIVATED",
        date: member.createdAt.toISOString(),
      }),
    ),
    ...invitations.map(
      (invitation): StaffListEntry => ({
        kind: "invitation",
        id: invitation.id,
        name: null,
        email: invitation.email,
        role: invitation.role,
        status: getInvitationStatus(invitation, now) === "INVITED" ? "INVITED" : "INVITE_EXPIRED",
        date: invitation.createdAt.toISOString(),
      }),
    ),
  ];
}

async function sendInvitation(
  inviter: Inviter,
  invitationId: string,
  email: string,
  token: string,
  expiresAt: Date,
): Promise<InvitationSent> {
  const inviteUrl = getInvitationUrl(token, getServerEnv().BETTER_AUTH_URL);
  const emailSent = await trySendEmail(
    buildInvitationEmail({
      to: email,
      storeName: inviter.storeName,
      inviterName: inviter.userName,
      url: inviteUrl,
      expiresAt,
      timeZone: inviter.timeZone,
    }),
    "invitation",
  );
  return { ok: true, invitationId, inviteUrl, emailSent };
}
