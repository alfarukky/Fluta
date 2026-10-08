import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { FakeMailer } from "@/test/fake-mailer";
import { postToAuth, randomIp, signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { createTestUser, deleteTestPeople, TEST_USER_PASSWORD, testEmail } from "@/test/integration/users";

import { authorizeStoreMember } from "./access";
import { getAuth } from "./auth";

const fakeMailer = vi.hoisted(() => ({ current: undefined as FakeMailer | undefined }));
vi.mock("@/server/integrations/email", () => ({ getMailer: () => fakeMailer.current }));

let prisma: PrismaClient;
let mailer: FakeMailer;
let freshFold: string;

beforeAll(async () => {
  prisma = createTestPrisma();
  mailer = new FakeMailer();
  fakeMailer.current = mailer;
  freshFold = (await prisma.store.findUniqueOrThrow({ where: { slug: "freshfold-laundry" } })).id;
});

beforeEach(() => mailer.reset());

afterEach(async () => {
  await deleteTestPeople(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

async function requestReset(email: string): Promise<{ status: number; body: unknown }> {
  const response = await postToAuth("/request-password-reset", { email, redirectTo: "/reset-password" });
  return { status: response.status, body: await response.json() };
}

// The emailed link is Better Auth's /api/auth/reset-password/<token>.
async function emailedToken(email: string): Promise<string> {
  await vi.waitFor(() => expect(mailer.lastTo(email)).toBeDefined(), { timeout: 10_000 });
  const link = mailer.lastTo(email)?.text.match(/https?:\/\/\S+\/reset-password\/(\S+?)\?/);
  if (!link) throw new Error("No reset link in the email");
  return link[1];
}

describe("password reset", () => {
  it("answers the same for known and unknown emails, and only emails a known one", async () => {
    const person = await createTestUser(prisma, "reset-known", { storeId: freshFold });

    const known = await requestReset(person.email);
    const unknown = await requestReset(testEmail("reset-unknown"));
    expect(known).toEqual(unknown);
    expect(known.status).toBe(200);

    const sent = await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
      return mailer.sent[0];
    });
    expect(sent.to).toBe(person.email);
    // The email starts with the person's store and says when the link expires.
    expect(sent.text.split("\n")[0]).toBe("FreshFold Laundry");
    expect(sent.text).toMatch(/expires in 1 hour/);
  });

  it("issues links that expire after 1 hour, stored only as a hash", async () => {
    const person = await createTestUser(prisma, "reset-expiry");
    const before = Date.now();
    await requestReset(person.email);
    const token = await emailedToken(person.email);

    // The verification row's value is the user ID; its identifier is a hash.
    const verification = await prisma.verification.findFirstOrThrow({ where: { value: person.id } });
    expect(verification.identifier).not.toContain(token);
    expect(verification.identifier).not.toContain("reset-password");
    expect(await prisma.verification.count({ where: { identifier: { contains: token } } })).toBe(0);

    const lifetime = verification.expiresAt.getTime() - before;
    expect(lifetime).toBeGreaterThan(59 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(61 * 60 * 1000);
  });

  it("refuses a 7-character password, then resets and signs the account out everywhere", async () => {
    const person = await createTestUser(prisma, "reset-flow", { storeId: freshFold });
    const existingSession = await signInHeaders(person.email, TEST_USER_PASSWORD);
    await requestReset(person.email);
    const token = await emailedToken(person.email);

    // Following the emailed link redirects to the reset page, and the raw
    // token is never stored (rate-limit rows are keyed by path).
    const origin = process.env.BETTER_AUTH_URL ?? "";
    const opened = await getAuth().handler(
      new Request(`${origin}/api/auth/reset-password/${token}?callbackURL=%2Freset-password`, {
        headers: { "x-real-ip": randomIp() },
      }),
    );
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toBe(`${origin}/reset-password?token=${token}`);
    expect(await prisma.rateLimit.count({ where: { key: { contains: token } } })).toBe(0);

    const short = await postToAuth("/reset-password", { newPassword: "1234567", token });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    // The refused attempt didn't use up the link or change the password.
    expect(await authorizeStoreMember(existingSession)).toMatchObject({ allowed: true });

    const reset = await postToAuth("/reset-password", { newPassword: "a-brand-new-password", token });
    expect(reset.status).toBe(200);
    expect(await authorizeStoreMember(existingSession)).toMatchObject({ allowed: false, status: 401 });
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);

    expect((await postToAuth("/sign-in/email", { email: person.email, password: TEST_USER_PASSWORD })).status).toBe(401);
    expect((await postToAuth("/sign-in/email", { email: person.email, password: "a-brand-new-password" })).status).toBe(200);
    // The link works once.
    expect((await postToAuth("/reset-password", { newPassword: "yet-another-password", token })).status).toBe(400);
  });
});
