import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";
import { createTestUser, deleteTestPeople, TEST_USER_PASSWORD } from "@/test/integration/users";

import { requireStoreMember } from "./session";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

let prisma: PrismaClient;
let stores: { freshFold: string; cleanWave: string };

beforeAll(async () => {
  prisma = createTestPrisma();
  const [freshFold, cleanWave] = await Promise.all(
    ["freshfold-laundry", "cleanwave-laundry"].map((slug) => prisma.store.findUniqueOrThrow({ where: { slug } })),
  );
  stores = { freshFold: freshFold.id, cleanWave: cleanWave.id };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteTestPeople(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

describe("requireStoreMember with more than one active membership", () => {
  it("refuses access and logs an error instead of picking one", async () => {
    const person = await createTestUser(prisma, "two-stores", { storeId: stores.freshFold });
    // Breaks the one-membership rule directly in the database; the app never does.
    await prisma.membership.create({ data: { userId: person.id, storeId: stores.cleanWave, role: "OWNER" } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    request.headers = await signInHeaders(person.email, TEST_USER_PASSWORD);
    expect(await requireStoreMember()).toEqual({ allowed: false, status: 403, reason: "MEMBERSHIP_CONFLICT" });
    expect(await requireStoreMember({ role: "OWNER" })).toMatchObject({ allowed: false, reason: "MEMBERSHIP_CONFLICT" });

    expect(errors).toHaveBeenCalledWith(expect.stringContaining(`user ${person.id} has more than one active membership`));
    // The log names the user ID only, never the email.
    expect(JSON.stringify(errors.mock.calls)).not.toContain(person.email);
  });
});
