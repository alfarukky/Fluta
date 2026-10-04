import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { postToAuth, randomIp, seedPassword, signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { getAuth } from "./auth";

const SEEDED_EMAILS = [
  "ada@freshfold.example",
  "kemi@freshfold.example",
  "musa@cleanwave.example",
  "admin@fluta.example",
];

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

describe("sign-up is impossible", () => {
  const newUser = { name: "Mallory", email: "mallory@example.com", password: "a-long-enough-password" };

  it("POST /api/auth/sign-up/email fails and creates no user, even asking for platformRole", async () => {
    const before = await prisma.user.count();
    for (const body of [newUser, { ...newUser, platformRole: "FLUTA_ADMIN" }]) {
      const response = await postToAuth("/sign-up/email", body);
      expect(response.status).toBe(404);
    }
    expect(await prisma.user.count()).toBe(before);
    expect(await prisma.user.findUnique({ where: { email: newUser.email } })).toBeNull();
  });

  it("is refused when called on the server too", async () => {
    await expect(getAuth().api.signUpEmail({ body: newUser })).rejects.toThrow();
    expect(await prisma.user.findUnique({ where: { email: newUser.email } })).toBeNull();
  });
});

describe("sign-in", () => {
  it("lets every seeded user sign in with SEED_USER_PASSWORD", async () => {
    for (const email of SEEDED_EMAILS) {
      const response = await postToAuth("/sign-in/email", { email, password: seedPassword() });
      expect(response.status, email).toBe(200);
    }
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const wrongPassword = await postToAuth("/sign-in/email", { email: SEEDED_EMAILS[0], password: "not-the-password" });
    const unknownEmail = await postToAuth("/sign-in/email", { email: "nobody@example.com", password: seedPassword() });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await unknownEmail.json()).toEqual(await wrongPassword.json());
  });

  it("rejects the 11th attempt within 5 minutes from one IP, counting in the RateLimit table", async () => {
    const ip = randomIp();
    const attempt = () =>
      postToAuth("/sign-in/email", { email: SEEDED_EMAILS[0], password: "not-the-password" }, ip);
    for (let index = 0; index < 10; index++) {
      expect((await attempt()).status).toBe(401);
    }
    expect((await attempt()).status).toBe(429);

    const counter = await prisma.rateLimit.findUnique({ where: { key: `${ip}|/sign-in/email` } });
    expect(counter?.count).toBe(10);
    // Another IP is unaffected.
    expect((await postToAuth("/sign-in/email", { email: SEEDED_EMAILS[0], password: seedPassword() })).status).toBe(200);
  }, 60_000);

  it("ends the session on sign-out", async () => {
    const headers = await signInHeaders(SEEDED_EMAILS[1]);
    expect(await getAuth().api.getSession({ headers })).not.toBeNull();
    await getAuth().api.signOut({ headers });
    expect(await getAuth().api.getSession({ headers })).toBeNull();
  });
});
