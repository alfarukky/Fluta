"use server";

import { revalidatePath } from "next/cache";

import { inviteStaffSchema, recordIdSchema, STAFF_MESSAGES } from "@/schemas/staff";
import { ownerEditRefusalMessage, type StoreMemberAccess } from "@/server/auth/access";
import { requireOwnerCanEdit } from "@/server/auth/session";
import {
  deactivateStaff as deactivate,
  inviteStaff as invite,
  reactivateStaff as reactivate,
  resendInvitation as resend,
  revokeInvitation as revoke,
  type Inviter,
} from "@/server/services/staff";

// Owner-only staff actions. Each one checks the membership and that the store
// may be edited (requireOwnerCanEdit), and the store is always the owner's
// own from that membership: an ID from the client is acted on only if it
// belongs to that store.

export type StaffActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

// The invite link is returned once, for Copy link, even when the email failed.
// invitationId is the new invitation's (on Resend, the replacement's).
export type InvitationActionResult =
  | { ok: true; message: string; invitationId: string; inviteUrl: string; emailSent: boolean }
  | { ok: false; message: string; fieldErrors?: Record<string, string>; pendingInvitationId?: string };

const NOT_OWNER = "Only the store owner can manage staff.";
const FAILED = "Something went wrong. Please try again.";
const STAFF_PATH = "/settings/staff";

type AllowedMember = Extract<StoreMemberAccess, { allowed: true }>;

export async function inviteStaff(formData: FormData): Promise<InvitationActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };

  const parsed = inviteStaffSchema.safeParse({ email: formData.get("email") ?? "" });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Enter a valid email address";
    return { ok: false, message, fieldErrors: { email: message } };
  }

  return run("inviting staff", async () => {
    const result = await invite(inviter(member), parsed.data.email);
    if (!result.ok) {
      return result.code === "EMAIL_IN_USE"
        ? { ok: false, message: STAFF_MESSAGES.emailInUse, fieldErrors: { email: STAFF_MESSAGES.emailInUse } }
        : { ok: false, message: STAFF_MESSAGES.pendingInvitation, pendingInvitationId: result.invitationId };
    }
    revalidatePath(STAFF_PATH);
    return {
      ok: true,
      message: result.emailSent ? STAFF_MESSAGES.invitationSent : STAFF_MESSAGES.invitationEmailFailed,
      invitationId: result.invitationId,
      inviteUrl: result.inviteUrl,
      emailSent: result.emailSent,
    };
  });
}

export async function resendInvitation(invitationId: unknown): Promise<InvitationActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };
  const id = recordIdSchema.safeParse(invitationId);
  if (!id.success) return { ok: false, message: STAFF_MESSAGES.invitationNotFound };

  return run("resending an invitation", async () => {
    const result = await resend(inviter(member), id.data);
    revalidatePath(STAFF_PATH);
    if (!result.ok) {
      return {
        ok: false,
        message: result.code === "EMAIL_IN_USE" ? STAFF_MESSAGES.emailInUse : STAFF_MESSAGES.invitationNotFound,
      };
    }
    return {
      ok: true,
      message: result.emailSent ? STAFF_MESSAGES.newInvitationSent : STAFF_MESSAGES.newInvitationEmailFailed,
      invitationId: result.invitationId,
      inviteUrl: result.inviteUrl,
      emailSent: result.emailSent,
    };
  });
}

export async function revokeInvitation(invitationId: unknown): Promise<StaffActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };
  const id = recordIdSchema.safeParse(invitationId);
  if (!id.success) return { ok: false, message: STAFF_MESSAGES.invitationNotFound };

  return run("revoking an invitation", async () => {
    const revoked = await revoke(member.store.id, id.data);
    revalidatePath(STAFF_PATH);
    return revoked
      ? { ok: true, message: STAFF_MESSAGES.invitationRevoked }
      : { ok: false, message: STAFF_MESSAGES.invitationNotFound };
  });
}

export async function deactivateStaff(membershipId: unknown): Promise<StaffActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };
  const id = recordIdSchema.safeParse(membershipId);
  if (!id.success) return { ok: false, message: STAFF_MESSAGES.staffNotFound };

  return run("deactivating staff", async () => {
    const result = await deactivate(member.store.id, id.data, member.user.id);
    revalidatePath(STAFF_PATH);
    return result.ok
      ? { ok: true, message: "Staff member deactivated and signed out" }
      : { ok: false, message: STAFF_MESSAGES.staffNotFound };
  });
}

export async function reactivateStaff(membershipId: unknown): Promise<StaffActionResult> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed) return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };
  const id = recordIdSchema.safeParse(membershipId);
  if (!id.success) return { ok: false, message: STAFF_MESSAGES.staffNotFound };

  return run("reactivating staff", async () => {
    const result = await reactivate(member.store.id, id.data, member.user.id);
    revalidatePath(STAFF_PATH);
    if (result.ok) return { ok: true, message: "Staff member reactivated" };
    return {
      ok: false,
      message: result.code === "ACTIVE_MEMBERSHIP_EXISTS" ? STAFF_MESSAGES.activeElsewhere : STAFF_MESSAGES.staffNotFound,
    };
  });
}

function inviter(member: AllowedMember): Inviter {
  return {
    storeId: member.store.id,
    storeName: member.store.name,
    timeZone: member.store.timeZone,
    userId: member.user.id,
    userName: member.user.name,
  };
}

// Unexpected errors are logged by class and Prisma code only: Prisma messages
// can repeat the query's values (emails).
async function run<Result extends { ok: boolean; message: string }>(
  step: string,
  work: () => Promise<Result>,
): Promise<Result | { ok: false; message: string }> {
  try {
    return await work();
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
    console.error(`[staff] ${step} failed:`, `${error instanceof Error ? error.name : "unknown error"}${code}`);
    return { ok: false, message: FAILED };
  }
}
