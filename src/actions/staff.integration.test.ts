import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { STAFF_MESSAGES } from "@/schemas/staff";
import { authorizeStoreMember } from "@/server/auth/access";
import { getPrisma } from "@/server/data/client";
import { hashToken } from "@/lib/tokens";
import { getStaffList } from "@/server/services/staff";
import { FakeMailer } from "@/test/fake-mailer";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { createTestUser, deleteTestPeople, TEST_USER_PASSWORD, testEmail } from "@/test/integration/users";

import { deactivateStaff, inviteStaff, reactivateStaff, resendInvitation, revokeInvitation } from "./staff";

// The actions read the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const fakeMailer = vi.hoisted(() => ({ current: undefined as FakeMailer | undefined }));
vi.mock("@/server/integrations/email", () => ({ getMailer: () => fakeMailer.current }));

const DAY_MS = 24 * 60 * 60 * 1000;

let prisma: PrismaClient;
let stores: { freshFold: string; cleanWave: string };
let signedIn: Record<"owner" | "staff" | "cleanWaveOwner", Headers>;
let mailer: FakeMailer;

beforeAll(async () => {
  prisma = createTestPrisma();
  mailer = new FakeMailer();
  fakeMailer.current = mailer;
  const [freshFold, cleanWave] = await Promise.all(
    ["freshfold-laundry", "cleanwave-laundry"].map((slug) => prisma.store.findUniqueOrThrow({ where: { slug } })),
  );
  stores = { freshFold: freshFold.id, cleanWave: cleanWave.id };
  signedIn = {
    owner: await signInHeaders("ada@freshfold.example"),
    staff: await signInHeaders("kemi@freshfold.example"),
    cleanWaveOwner: await signInHeaders("musa@cleanwave.example"),
  };
});

beforeEach(() => mailer.reset());

afterEach(async () => {
  await deleteTestPeople(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function tokenFrom(inviteUrl: string): string {
  return new URL(inviteUrl).pathname.split("/").at(-1) ?? "";
}

async function inviteAs(who: keyof typeof signedIn, email: string) {
  request.headers = signedIn[who];
  const result = await inviteStaff(form({ email }));
  if (!result.ok) throw new Error(`inviteStaff failed: ${result.message}`);
  const invitation = await prisma.storeInvitation.findUniqueOrThrow({
    where: { tokenHash: hashToken(tokenFrom(result.inviteUrl)) },
  });
  return { result, invitation };
}

function readInvitation(id: string) {
  return prisma.storeInvitation.findUniqueOrThrow({ where: { id } });
}

function readMembership(id: string) {
  return prisma.membership.findUniqueOrThrow({ where: { id } });
}

describe("access", () => {
  it("refuses staff: they cannot invite, resend, revoke, deactivate, or reactivate", async () => {
    const { invitation } = await inviteAs("owner", testEmail("pending"));
    const colleague = await createTestUser(prisma, "colleague", { storeId: stores.freshFold });
    const former = await createTestUser(prisma, "former", { storeId: stores.freshFold });
    await prisma.membership.update({ where: { id: former.membershipId! }, data: { isActive: false, deactivatedAt: new Date() } });

    request.headers = signedIn.staff;
    expect(await inviteStaff(form({ email: testEmail("by-staff") }))).toMatchObject({ ok: false });
    expect(await resendInvitation(invitation.id)).toMatchObject({ ok: false });
    expect(await revokeInvitation(invitation.id)).toMatchObject({ ok: false });
    expect(await deactivateStaff(colleague.membershipId)).toMatchObject({ ok: false });
    expect(await reactivateStaff(former.membershipId)).toMatchObject({ ok: false });

    expect(await readInvitation(invitation.id)).toMatchObject({ revokedAt: null, acceptedAt: null });
    expect(await prisma.storeInvitation.count({ where: { storeId: stores.freshFold, email: { startsWith: "by-staff" } } })).toBe(0);
    expect(await readMembership(colleague.membershipId!)).toMatchObject({ isActive: true });
    expect(await readMembership(former.membershipId!)).toMatchObject({ isActive: false });
  });

  // Many actions in a row, each several round trips to Neon.
  it("never lets a FreshFold owner act on a CleanWave membership or invitation, even by sending its ID", async () => {
    const { invitation } = await inviteAs("cleanWaveOwner", testEmail("cleanwave-invite"));
    const cleanWaveStaff = await createTestUser(prisma, "cleanwave-staff", { storeId: stores.cleanWave });
    const cleanWaveFormer = await createTestUser(prisma, "cleanwave-former", { storeId: stores.cleanWave });
    await prisma.membership.update({
      where: { id: cleanWaveFormer.membershipId! },
      data: { isActive: false, deactivatedAt: new Date() },
    });

    request.headers = signedIn.owner;
    expect(await resendInvitation(invitation.id)).toMatchObject({ ok: false });
    expect(await revokeInvitation(invitation.id)).toMatchObject({ ok: false });
    expect(await deactivateStaff(cleanWaveStaff.membershipId)).toMatchObject({ ok: false });
    expect(await reactivateStaff(cleanWaveFormer.membershipId)).toMatchObject({ ok: false });

    expect(await readInvitation(invitation.id)).toMatchObject({ revokedAt: null });
    expect(await prisma.storeInvitation.count({ where: { email: invitation.email } })).toBe(1);
    expect(await readMembership(cleanWaveStaff.membershipId!)).toMatchObject({ isActive: true });
    expect(await readMembership(cleanWaveFormer.membershipId!)).toMatchObject({ isActive: false });
    expect(mailer.sent).toHaveLength(1);

    // A store ID in the form is ignored: the invitation is for the owner's own store.
    const email = testEmail("own-store");
    const result = await inviteStaff(form({ email, storeId: stores.cleanWave }));
    expect(result).toMatchObject({ ok: true });
    expect(await prisma.storeInvitation.findFirstOrThrow({ where: { email } })).toMatchObject({ storeId: stores.freshFold });
  }, 60_000);
});

describe("inviting", () => {
  it("refuses an email with an active membership at any store, with one message that names no store", async () => {
    request.headers = signedIn.owner;
    for (const email of ["musa@cleanwave.example", "  MUSA@CleanWave.example ", "kemi@freshfold.example"]) {
      expect(await inviteStaff(form({ email }))).toEqual({
        ok: false,
        message: STAFF_MESSAGES.emailInUse,
        fieldErrors: { email: STAFF_MESSAGES.emailInUse },
      });
    }
    expect(await prisma.storeInvitation.count({ where: { email: { in: ["musa@cleanwave.example", "kemi@freshfold.example"] } } })).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it("offers Resend instead of a second invitation while one is pending", async () => {
    const email = testEmail("twice");
    const { invitation } = await inviteAs("owner", email);
    expect(await inviteStaff(form({ email: email.toUpperCase() }))).toMatchObject({
      ok: false,
      message: STAFF_MESSAGES.pendingInvitation,
      pendingInvitationId: invitation.id,
    });
    expect(await prisma.storeInvitation.count({ where: { email } })).toBe(1);
  });

  it("stores the normalized email and only the token's hash, valid for 7 days", async () => {
    const email = testEmail("john");
    const typed = `  ${email.replace("john", "John").toUpperCase()} `;
    const before = Date.now();
    request.headers = signedIn.owner;
    const result = await inviteStaff(form({ email: typed }));
    if (!result.ok) throw new Error(result.message);

    const token = tokenFrom(result.inviteUrl);
    const invitation = await prisma.storeInvitation.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(invitation).toMatchObject({ email, role: "STAFF", storeId: stores.freshFold });
    expect(JSON.stringify(invitation)).not.toContain(token);
    expect(invitation.expiresAt.getTime() - before).toBeGreaterThanOrEqual(7 * DAY_MS - 1000);
    expect(invitation.expiresAt.getTime() - before).toBeLessThanOrEqual(7 * DAY_MS + 60_000);

    // The email starts with the store's name and carries the link and its expiry.
    const sent = mailer.lastTo(email);
    expect(sent?.text.split("\n")[0]).toBe("FreshFold Laundry");
    expect(sent?.text).toContain(result.inviteUrl);
    expect(sent?.text).toMatch(/expires in 7 days/);
  });

  it("keeps the invitation and still shows the link when the email can't be sent", async () => {
    mailer.failSends = true;
    request.headers = signedIn.owner;
    const result = await inviteStaff(form({ email: testEmail("no-email") }));
    expect(result).toMatchObject({ ok: true, emailSent: false, message: STAFF_MESSAGES.invitationEmailFailed });
    if (!result.ok) return;
    expect(await prisma.storeInvitation.findUnique({ where: { tokenHash: hashToken(tokenFrom(result.inviteUrl)) } })).not.toBeNull();
  });
});

describe("resending and revoking", () => {
  it("resend replaces the invitation: the old link stops working, the new one is shown", async () => {
    const { invitation } = await inviteAs("owner", testEmail("resend"));
    const result = await resendInvitation(invitation.id);
    expect(result).toMatchObject({ ok: true, emailSent: true, message: STAFF_MESSAGES.newInvitationSent });
    if (!result.ok) return;

    expect((await readInvitation(invitation.id)).revokedAt).not.toBeNull();
    const replacement = await prisma.storeInvitation.findUniqueOrThrow({
      where: { tokenHash: hashToken(tokenFrom(result.inviteUrl)) },
    });
    expect(replacement).toMatchObject({ email: invitation.email, storeId: stores.freshFold, revokedAt: null });
  });

  it("still shows the new link when the email on Resend fails", async () => {
    const { invitation } = await inviteAs("owner", testEmail("resend-no-email"));
    mailer.failSends = true;
    const result = await resendInvitation(invitation.id);
    expect(result).toMatchObject({ ok: true, emailSent: false, message: STAFF_MESSAGES.newInvitationEmailFailed });
    expect(result.ok && result.inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  });

  it("can resend an expired invitation, but revoke only a pending one", async () => {
    const { invitation } = await inviteAs("owner", testEmail("expired"));
    await prisma.storeInvitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - DAY_MS) } });

    expect(await revokeInvitation(invitation.id)).toMatchObject({ ok: false });
    expect(await resendInvitation(invitation.id)).toMatchObject({ ok: true });

    const pending = await prisma.storeInvitation.findFirstOrThrow({ where: { email: invitation.email, revokedAt: null } });
    expect(await revokeInvitation(pending.id)).toEqual({ ok: true, message: STAFF_MESSAGES.invitationRevoked });
    expect((await readInvitation(pending.id)).revokedAt).not.toBeNull();
    // A revoked invitation can't be resent or revoked again.
    expect(await resendInvitation(pending.id)).toMatchObject({ ok: false });
    expect(await revokeInvitation(pending.id)).toMatchObject({ ok: false });
  });
});

describe("the staff list", () => {
  it("hides revoked, replaced, accepted, and 30-day-old expired invitations without deleting them", async () => {
    const now = Date.now();
    const make = (label: string, data: { expiresAt: Date; acceptedAt?: Date; revokedAt?: Date }) =>
      prisma.storeInvitation.create({
        data: {
          storeId: stores.freshFold,
          email: testEmail(label),
          role: "STAFF",
          tokenHash: hashToken(`${label}-${now}`),
          invitedByUserId: "test",
          ...data,
        },
      });
    const pending = await make("list-pending", { expiresAt: new Date(now + DAY_MS) });
    const recent = await make("list-expired-recently", { expiresAt: new Date(now - 10 * DAY_MS) });
    const hidden = await Promise.all([
      make("list-revoked", { expiresAt: new Date(now + DAY_MS), revokedAt: new Date(now) }),
      make("list-accepted", { expiresAt: new Date(now + DAY_MS), acceptedAt: new Date(now) }),
      make("list-expired-long-ago", { expiresAt: new Date(now - 31 * DAY_MS) }),
    ]);
    const { invitation: replaced } = await inviteAs("owner", testEmail("list-replaced"));
    request.headers = signedIn.owner;
    await resendInvitation(replaced.id);

    const listed = (await getStaffList(stores.freshFold)).filter((entry) => entry.kind === "invitation");
    const statusById = new Map(listed.map((entry) => [entry.id, entry.status]));
    expect(statusById.get(pending.id)).toBe("INVITED");
    expect(statusById.get(recent.id)).toBe("INVITE_EXPIRED");
    for (const invitation of [...hidden, replaced]) expect(statusById.has(invitation.id)).toBe(false);
    // The replacement is listed instead of the replaced one.
    expect(listed.filter((entry) => entry.email === replaced.email)).toHaveLength(1);

    expect(await prisma.storeInvitation.count({ where: { id: { in: [...hidden, replaced].map(({ id }) => id) } } })).toBe(4);
  });

  it("lists members with their status, owners included", async () => {
    const list = await getStaffList(stores.freshFold);
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "member", email: "ada@freshfold.example", role: "OWNER", status: "ACTIVE" }),
        expect.objectContaining({ kind: "member", email: "kemi@freshfold.example", role: "STAFF", status: "ACTIVE" }),
      ]),
    );
    expect(list.some((entry) => entry.email === "musa@cleanwave.example")).toBe(false);
  });
});

describe("deactivating and reactivating", () => {
  it("never deactivates an owner, including the owner themselves", async () => {
    const owner = await prisma.membership.findFirstOrThrow({ where: { storeId: stores.freshFold, role: "OWNER" } });
    request.headers = signedIn.owner;
    expect(await deactivateStaff(owner.id)).toMatchObject({ ok: false });
    expect(await readMembership(owner.id)).toMatchObject({ isActive: true, deactivatedAt: null });
  });

  // Four sign-ins and a dozen actions in a row, each several round trips to Neon.
  it("revokes every session so the next request is refused; reactivating restores access", async () => {
    const person = await createTestUser(prisma, "deactivated", { storeId: stores.freshFold });
    const phone = await signInHeaders(person.email, TEST_USER_PASSWORD);
    const laptop = await signInHeaders(person.email, TEST_USER_PASSWORD);
    expect(await authorizeStoreMember(phone)).toMatchObject({ allowed: true });

    request.headers = signedIn.owner;
    expect(await deactivateStaff(person.membershipId)).toMatchObject({ ok: true });
    expect(await readMembership(person.membershipId!)).toMatchObject({ isActive: false, deactivatedAt: expect.any(Date) });
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
    for (const device of [phone, laptop]) {
      expect(await authorizeStoreMember(device)).toMatchObject({ allowed: false, status: 401 });
    }
    // Signing in again works, but the workspace stays closed.
    expect(await authorizeStoreMember(await signInHeaders(person.email, TEST_USER_PASSWORD))).toMatchObject({
      allowed: false,
      reason: "NO_ACTIVE_MEMBERSHIP",
    });

    expect(await reactivateStaff(person.membershipId)).toMatchObject({ ok: true });
    expect(await readMembership(person.membershipId!)).toMatchObject({ isActive: true, deactivatedAt: null });
    expect(await authorizeStoreMember(await signInHeaders(person.email, TEST_USER_PASSWORD))).toMatchObject({
      allowed: true,
      store: { id: stores.freshFold },
    });

    const events = await prisma.auditEvent.findMany({
      where: { targetId: person.membershipId },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual(["STAFF_DEACTIVATED", "STAFF_REACTIVATED"]);
    expect(events[0]).toMatchObject({ storeId: stores.freshFold, targetType: "Membership", metadata: { userId: person.id } });
  }, 60_000);

  it("won't reactivate someone who now has an active membership at another store", async () => {
    const person = await createTestUser(prisma, "moved-on", { storeId: stores.freshFold });
    request.headers = signedIn.owner;
    await deactivateStaff(person.membershipId);
    await prisma.membership.create({ data: { userId: person.id, storeId: stores.cleanWave, role: "STAFF" } });

    expect(await reactivateStaff(person.membershipId)).toEqual({ ok: false, message: STAFF_MESSAGES.activeElsewhere });
    expect(await readMembership(person.membershipId!)).toMatchObject({ isActive: false });
  });
});
