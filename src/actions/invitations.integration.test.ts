import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { INVITATION_MESSAGES, STAFF_MESSAGES } from "@/schemas/staff";
import { getAuth } from "@/server/auth/auth";
import { getPrisma } from "@/server/data/client";
import { hashToken } from "@/lib/tokens";
import { FakeMailer } from "@/test/fake-mailer";
import { postToAuth, signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { createTestUser, deleteTestPeople, testEmail } from "@/test/integration/users";

import { acceptInvitation, joinWithExistingAccount } from "./invitations";
import { inviteStaff, resendInvitation, revokeInvitation } from "./staff";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// redirect() ends the action, as it does in Next.js.
const Redirect = vi.hoisted(() => class Redirect extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Redirect(path);
  },
}));
const fakeMailer = vi.hoisted(() => ({ current: undefined as FakeMailer | undefined }));
vi.mock("@/server/integrations/email", () => ({ getMailer: () => fakeMailer.current }));

let prisma: PrismaClient;
let stores: { freshFold: string; cleanWave: string };
let owner: Headers;

beforeAll(async () => {
  prisma = createTestPrisma();
  fakeMailer.current = new FakeMailer();
  const [freshFold, cleanWave] = await Promise.all(
    ["freshfold-laundry", "cleanwave-laundry"].map((slug) => prisma.store.findUniqueOrThrow({ where: { slug } })),
  );
  stores = { freshFold: freshFold.id, cleanWave: cleanWave.id };
  owner = await signInHeaders("ada@freshfold.example");
});

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

// Invites as the FreshFold owner and returns the raw token from the link.
async function invite(email: string): Promise<{ token: string; invitationId: string }> {
  request.headers = owner;
  const result = await inviteStaff(form({ email }));
  if (!result.ok) throw new Error(`inviteStaff failed: ${result.message}`);
  const token = new URL(result.inviteUrl).pathname.split("/").at(-1) ?? "";
  const { id } = await prisma.storeInvitation.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
  return { token, invitationId: id };
}

const NEW_ACCOUNT = { name: "  New Person ", password: "a-good-password" };

// Runs an acceptance action with the given browser headers (no session by
// default); returns where it redirected, or the result it returned.
async function run(action: () => Promise<unknown>, headers = new Headers()) {
  request.headers = headers;
  try {
    return await action();
  } catch (error) {
    if (error instanceof Redirect) return { redirectedTo: error.path };
    throw error;
  }
}

function acceptNew(token: string, values: Record<string, string> = NEW_ACCOUNT, headers?: Headers) {
  return run(() => acceptInvitation(token, form(values)), headers);
}

function join(token: string, headers?: Headers) {
  return run(() => joinWithExistingAccount(token), headers);
}



function usersWithEmail(email: string) {
  return prisma.user.findMany({ where: { email }, include: { memberships: true } });
}

describe("a new account", () => {
  it("creates exactly one user and one membership, signs them in, and the link can't be used again", async () => {
    const email = testEmail("new");
    const { token, invitationId } = await invite(email);

    expect(await acceptNew(token)).toEqual({ redirectedTo: "/overview" });
    const [user, ...others] = await usersWithEmail(email);
    expect(others).toHaveLength(0);
    expect(user).toMatchObject({ name: "New Person", platformRole: "USER" });
    expect(user.memberships).toEqual([expect.objectContaining({ storeId: stores.freshFold, role: "STAFF", isActive: true })]);
    // Signed in: a session was created for the new user.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect((await prisma.storeInvitation.findUniqueOrThrow({ where: { id: invitationId } })).acceptedAt).not.toBeNull();

    expect(await acceptNew(token, { name: "Someone Else", password: "another-password" })).toEqual({
      ok: false,
      message: INVITATION_MESSAGES.invalid,
    });
    expect(await usersWithEmail(email)).toHaveLength(1);
  });

  it("gives one user and one membership when two requests for the same link arrive at once", async () => {
    const email = testEmail("race");
    const { token } = await invite(email);

    const results = await Promise.all([acceptNew(token), acceptNew(token, { name: "Twin", password: "twin-password" })]);
    expect(results).toEqual(
      expect.arrayContaining([{ redirectedTo: "/overview" }, { ok: false, message: INVITATION_MESSAGES.invalid }]),
    );
    const users = await usersWithEmail(email);
    expect(users).toHaveLength(1);
    expect(users[0].memberships).toHaveLength(1);
  });

  it("refuses a 7-character password and creates nothing", async () => {
    const email = testEmail("short-password");
    const { token, invitationId } = await invite(email);

    const result = await acceptNew(token, { name: "Short", password: "1234567" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { password: expect.stringContaining("8") } });
    expect(await usersWithEmail(email)).toHaveLength(0);
    expect((await prisma.storeInvitation.findUniqueOrThrow({ where: { id: invitationId } })).acceptedAt).toBeNull();
  });

  it("uses the invitation's normalized email, so sign-in works with any capitalisation", async () => {
    const email = testEmail("john");
    const { token } = await invite(`  ${email.toUpperCase()} `);

    // An email in the request is ignored.
    expect(await acceptNew(token, { ...NEW_ACCOUNT, email: testEmail("intruder") })).toEqual({ redirectedTo: "/overview" });
    expect(await usersWithEmail(email)).toHaveLength(1);

    for (const typed of [email, email.toUpperCase(), ` ${email.replace(/^./, (c) => c.toUpperCase())}`]) {
      const response = await postToAuth("/sign-in/email", { email: typed.trim(), password: NEW_ACCOUNT.password });
      expect(response.status, typed).toBe(200);
    }
  });
});

describe("whoever is signed in in this browser", () => {
  it("doesn't matter: a new account is created and the current session is left unchanged", async () => {
    const email = testEmail("while-owner-signed-in");
    const { token } = await invite(email);
    const ownerSession = await signInHeaders("ada@freshfold.example");
    const ownerToken = (await getAuth().api.getSession({ headers: ownerSession }))?.session.token;

    expect(await acceptNew(token, NEW_ACCOUNT, ownerSession)).toEqual({ ok: true, email, someoneElseSignedIn: true });
    const [user] = await usersWithEmail(email);
    expect(user.memberships).toEqual([expect.objectContaining({ storeId: stores.freshFold, role: "STAFF", isActive: true })]);
    // Not signed in as the new person, and the owner's session is untouched.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    const after = await getAuth().api.getSession({ headers: ownerSession });
    expect(after?.user.email).toBe("ada@freshfold.example");
    expect(after?.session.token).toBe(ownerToken);

    // The new person signs in themselves.
    expect((await postToAuth("/sign-in/email", { email, password: NEW_ACCOUNT.password })).status).toBe(200);
  });
});

describe("an existing account", () => {
  it("joins without signing in; the page then opens sign-in (email never in a URL)", async () => {
    const person = await createTestUser(prisma, "existing");
    const { token, invitationId } = await invite(person.email);

    // Creating a second account for the email is refused, and the claim rolled back.
    expect(await acceptNew(token)).toEqual({ ok: false, message: INVITATION_MESSAGES.accountExists });
    expect((await prisma.storeInvitation.findUniqueOrThrow({ where: { id: invitationId } })).acceptedAt).toBeNull();

    expect(await join(token)).toEqual({ ok: true, email: person.email, someoneElseSignedIn: false });
    expect(await prisma.membership.findMany({ where: { userId: person.id } })).toEqual([
      expect.objectContaining({ storeId: stores.freshFold, role: "STAFF", isActive: true }),
    ]);
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
    expect(await usersWithEmail(person.email)).toHaveLength(1);
    // Single use.
    expect(await join(token)).toEqual({ ok: false, message: INVITATION_MESSAGES.invalid });
  });

  it("joins the invited account even while someone else is signed in, leaving that session alone", async () => {
    const person = await createTestUser(prisma, "existing-other-session");
    const { token } = await invite(person.email);
    const ownerSession = await signInHeaders("ada@freshfold.example");

    expect(await join(token, ownerSession)).toEqual({ ok: true, email: person.email, someoneElseSignedIn: true });
    // The membership is the invited account's, never the signed-in owner's.
    expect(await prisma.membership.count({ where: { userId: person.id, storeId: stores.freshFold, isActive: true } })).toBe(1);
    expect((await getAuth().api.getSession({ headers: ownerSession }))?.user.email).toBe("ada@freshfold.example");
  });

  it("can't accept an older invitation after gaining an active membership elsewhere", async () => {
    const person = await createTestUser(prisma, "joined-elsewhere");
    const { token, invitationId } = await invite(person.email);
    await prisma.membership.create({ data: { userId: person.id, storeId: stores.cleanWave, role: "STAFF" } });

    expect(await join(token)).toEqual({ ok: false, message: INVITATION_MESSAGES.activeElsewhere });
    expect(await prisma.membership.findMany({ where: { userId: person.id, storeId: stores.freshFold } })).toEqual([]);
    expect((await prisma.storeInvitation.findUniqueOrThrow({ where: { id: invitationId } })).acceptedAt).toBeNull();

    // And such an email can't be invited in the first place.
    request.headers = owner;
    expect(await inviteStaff(form({ email: person.email }))).toMatchObject({
      ok: false,
      message: STAFF_MESSAGES.emailInUse,
    });
  });

  it("can't join with a link for an email that has no account yet", async () => {
    const { token, invitationId } = await invite(testEmail("no-account-yet"));
    expect(await join(token)).toEqual({ ok: false, message: INVITATION_MESSAGES.noAccount });
    expect((await prisma.storeInvitation.findUniqueOrThrow({ where: { id: invitationId } })).acceptedAt).toBeNull();
  });
});

describe("Fluta admin accounts", () => {
  it("can't be invited", async () => {
    request.headers = owner;
    expect(await inviteStaff(form({ email: " Admin@Fluta.example " }))).toMatchObject({
      ok: false,
      message: STAFF_MESSAGES.emailInUse,
    });
    expect(await prisma.storeInvitation.count({ where: { email: "admin@fluta.example" } })).toBe(0);
  });

  it("can't join with an invitation sent before the account became an admin", async () => {
    const person = await createTestUser(prisma, "became-admin");
    const { token, invitationId } = await invite(person.email);
    await prisma.user.update({ where: { id: person.id }, data: { platformRole: "FLUTA_ADMIN" } });

    expect(await join(token)).toEqual({ ok: false, message: INVITATION_MESSAGES.activeElsewhere });
    expect(await prisma.membership.count({ where: { userId: person.id } })).toBe(0);
    expect((await prisma.storeInvitation.findUniqueOrThrow({ where: { id: invitationId } })).acceptedAt).toBeNull();
  });
});

describe("links that no longer work", () => {
  // About ten actions in a row, each several round trips to Neon.
  it("expired, revoked, and replaced links fail with one message", async () => {
    const expired = await invite(testEmail("expired-link"));
    await prisma.storeInvitation.update({ where: { id: expired.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const revoked = await invite(testEmail("revoked-link"));
    request.headers = owner;
    await revokeInvitation(revoked.invitationId);

    const replaced = await invite(testEmail("replaced-link"));
    request.headers = owner;
    const resent = await resendInvitation(replaced.invitationId);
    expect(resent.ok).toBe(true);

    for (const { token } of [expired, revoked, replaced]) {
      expect(await acceptNew(token)).toEqual({ ok: false, message: INVITATION_MESSAGES.invalid });
    }
    for (const token of ["not-a-token", "a".repeat(43)]) {
      expect(await acceptNew(token)).toEqual({ ok: false, message: INVITATION_MESSAGES.invalid });
    }
    expect(await prisma.user.count({ where: { email: { contains: "-link-" } } })).toBe(0);

    // The replacement link still works.
    const newToken = resent.ok ? new URL(resent.inviteUrl).pathname.split("/").at(-1)! : "";
    expect(await acceptNew(newToken)).toEqual({ redirectedTo: "/overview" });
  }, 60_000);
});
