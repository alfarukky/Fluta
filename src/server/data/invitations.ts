import "server-only";

import { Prisma, type StoreRole } from "@/generated/prisma/client";
import { normalizeEmail } from "@/lib/email-address";

import { STORE_ACCESS_SELECT } from "./access";
import { getPrisma } from "./client";
import { addMembership } from "./memberships";
import { insertUserWithPassword, type PreparedUser } from "./users";

// Staff invitations, always scoped to one store: storeId comes from the
// owner's membership, and an invitation ID from the client is acted on only
// if it belongs to that store. Emails are normalized (normalizeEmail).

// Neon round trips are slow from here; the default 5s can expire mid-write.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export interface NewInvitationToken {
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
}

export type CreateInvitationResult =
  | { ok: true; invitationId: string; email: string }
  | { ok: false; code: "EMAIL_IN_USE" }
  | { ok: false; code: "PENDING_INVITATION_EXISTS"; invitationId: string };

// Refused if the email can't join a store (an active membership anywhere, by
// the one-membership rule, or a Fluta admin account) or has a pending
// invitation to this store (the owner resends that one instead). Unaccepted
// expired invitations for the same email are replaced.
export async function createStaffInvitation(
  storeId: string,
  email: string,
  token: NewInvitationToken,
  now: Date,
): Promise<CreateInvitationResult> {
  const normalized = normalizeEmail(email);
  return getPrisma().$transaction(async (tx) => {
    await lockInvitationEmail(storeId, normalized, tx);
    if (await emailCantJoin(normalized, tx)) return { ok: false, code: "EMAIL_IN_USE" };

    const pending = await tx.storeInvitation.findFirst({
      where: { storeId, email: normalized, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    if (pending) return { ok: false, code: "PENDING_INVITATION_EXISTS", invitationId: pending.id };

    await tx.storeInvitation.updateMany({
      where: { storeId, email: normalized, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const invitation = await tx.storeInvitation.create({
      data: { storeId, email: normalized, role: "STAFF", ...token },
      select: { id: true },
    });
    return { ok: true, invitationId: invitation.id, email: normalized };
  }, TRANSACTION_OPTIONS);
}

export type ReplaceInvitationResult =
  | { ok: true; invitationId: string; email: string }
  | { ok: false; code: "NOT_FOUND" | "EMAIL_IN_USE" };

// Resend: a new token for a pending or expired invitation of this store. The
// previous invitation is revoked (replaced), so its link stops working.
export async function replaceStaffInvitation(
  storeId: string,
  invitationId: string,
  token: NewInvitationToken,
  now: Date,
): Promise<ReplaceInvitationResult> {
  return getPrisma().$transaction(async (tx) => {
    const previous = await tx.storeInvitation.findFirst({
      where: { id: invitationId, storeId, acceptedAt: null, revokedAt: null },
      select: { email: true, role: true },
    });
    if (!previous) return { ok: false, code: "NOT_FOUND" };

    await lockInvitationEmail(storeId, previous.email, tx);
    if (await emailCantJoin(previous.email, tx)) return { ok: false, code: "EMAIL_IN_USE" };

    const { count } = await tx.storeInvitation.updateMany({
      where: { id: invitationId, storeId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count !== 1) return { ok: false, code: "NOT_FOUND" };

    const invitation = await tx.storeInvitation.create({
      data: { storeId, email: previous.email, role: previous.role, ...token },
      select: { id: true },
    });
    return { ok: true, invitationId: invitation.id, email: previous.email };
  }, TRANSACTION_OPTIONS);
}

// Revoke: pending invitations of this store only. False if there was none.
export async function revokeStaffInvitation(storeId: string, invitationId: string, now: Date): Promise<boolean> {
  const { count } = await getPrisma().storeInvitation.updateMany({
    where: { id: invitationId, storeId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now },
  });
  return count === 1;
}

// For the staff list: unaccepted, unrevoked invitations that are pending or
// expired after `expiredSince` (src/server/domain/invitations.ts).
export async function listOpenInvitations(storeId: string, expiredSince: Date) {
  return getPrisma().storeInvitation.findMany({
    where: { storeId, acceptedAt: null, revokedAt: null, expiresAt: { gt: expiredSince } },
    select: { id: true, email: true, role: true, createdAt: true, expiresAt: true, acceptedAt: true, revokedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

// The invitation behind a link, with what the acceptance page shows and
// checks. Looked up by the token's hash only.
export async function findInvitationByTokenHash(tokenHash: string) {
  return getPrisma().storeInvitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      store: { select: STORE_ACCESS_SELECT },
    },
  });
}

export type InvitationForAcceptance = NonNullable<Awaited<ReturnType<typeof findInvitationByTokenHash>>>;

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const user = await getPrisma().user.findUnique({ where: { email: normalizeEmail(email) }, select: { id: true } });
  return user?.id ?? null;
}

// Whether the invited email's account (if any) can't join a store: it has an
// active membership somewhere or is a Fluta admin. Such an invitation can't
// be accepted.
export async function invitedEmailCantJoin(email: string): Promise<boolean> {
  return emailCantJoin(normalizeEmail(email), getPrisma());
}

export type AcceptInvitationResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; code: "INVALID" | "ACCOUNT_EXISTS" | "NO_ACCOUNT" | "EMAIL_IN_USE" };

type AcceptanceRefusal = Exclude<AcceptInvitationResult, { ok: true }>["code"];

// Thrown inside the transaction to roll everything back, the claim included.
class AcceptanceRefused extends Error {
  constructor(readonly code: AcceptanceRefusal) {
    super(code);
  }
}

// A new account: the user is created with the invitation's email (never one
// from the request), then the membership, in the transaction that claims the
// invitation.
export async function acceptInvitationAsNewUser(
  tokenHash: string,
  user: Omit<PreparedUser, "email" | "platformRole">,
  now: Date,
): Promise<AcceptInvitationResult> {
  return acceptInvitation(tokenHash, now, async (invitation, tx) => {
    const existing = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    if (existing) throw new AcceptanceRefused("ACCOUNT_EXISTS");
    const created = await insertUserWithPassword({ ...user, email: invitation.email, platformRole: "USER" }, tx);
    return created.id;
  });
}

// An existing account: the account with the invitation's email joins. Nobody
// needs to be signed in, and who is signed in doesn't matter: the private link
// is the credential, as it is for a new account.
export async function acceptInvitationForExistingAccount(tokenHash: string, now: Date): Promise<AcceptInvitationResult> {
  return acceptInvitation(tokenHash, now, async (invitation, tx) => {
    const user = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true, platformRole: true } });
    if (!user) throw new AcceptanceRefused("NO_ACCOUNT");
    // A Fluta admin account never becomes a store member, even if it was
    // invited before it became an admin.
    if (user.platformRole === "FLUTA_ADMIN") throw new AcceptanceRefused("EMAIL_IN_USE");
    return user.id;
  });
}

// Claims the invitation with one conditional update (only while it is still
// unaccepted, unrevoked, and unexpired), then finds or creates the user and
// adds the membership, all in one transaction. Two requests for one link
// can't both claim it: the second waits for the first's row lock and then
// matches nothing. Any refusal or failure rolls back the claim too.
async function acceptInvitation(
  tokenHash: string,
  now: Date,
  resolveUser: (
    invitation: { storeId: string; email: string; role: StoreRole },
    tx: Prisma.TransactionClient,
  ) => Promise<string>,
): Promise<AcceptInvitationResult> {
  try {
    return await getPrisma().$transaction(async (tx) => {
      const { count } = await tx.storeInvitation.updateMany({
        where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      });
      if (count !== 1) throw new AcceptanceRefused("INVALID");

      const invitation = await tx.storeInvitation.findUniqueOrThrow({
        where: { tokenHash },
        select: { storeId: true, email: true, role: true },
      });
      const userId = await resolveUser(invitation, tx);
      const membership = await addMembership(invitation.storeId, { userId, role: invitation.role }, tx);
      if (!membership.success) throw new AcceptanceRefused("EMAIL_IN_USE");
      return { ok: true as const, userId, email: invitation.email };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof AcceptanceRefused) return { ok: false, code: error.code };
    // Another request created a user with this email first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, code: "ACCOUNT_EXISTS" };
    }
    throw error;
  }
}

// Serializes invitation changes for one email at one store, so two invites
// sent at once can't both pass the "no pending invitation" check. ($executeRaw:
// the function returns void, which $queryRaw can't read.)
async function lockInvitationEmail(storeId: string, email: string, tx: Prisma.TransactionClient): Promise<void> {
  const key = `invitation:${storeId}:${email}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

// An active membership anywhere (one membership per user) or a Fluta admin
// account: either way the email can't be invited or join.
async function emailCantJoin(email: string, db: Prisma.TransactionClient): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { email },
    select: { platformRole: true, memberships: { where: { isActive: true }, select: { id: true }, take: 1 } },
  });
  return user !== null && (user.platformRole === "FLUTA_ADMIN" || user.memberships.length > 0);
}
