import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { createMembership } from "@/server/data/memberships";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { authorizeFlutaAdmin, authorizeStoreMember } from "./access";

let prisma: PrismaClient;
let stores: { freshFold: string; cleanWave: string };
let headers: Record<"owner" | "staff" | "cleanWave" | "admin", Headers>;

beforeAll(async () => {
  prisma = createTestPrisma();
  const [freshFold, cleanWave] = await Promise.all(
    ["freshfold-laundry", "cleanwave-laundry"].map((slug) => prisma.store.findUniqueOrThrow({ where: { slug } })),
  );
  stores = { freshFold: freshFold.id, cleanWave: cleanWave.id };
  headers = {
    owner: await signInHeaders("ada@freshfold.example"),
    staff: await signInHeaders("kemi@freshfold.example"),
    cleanWave: await signInHeaders("musa@cleanwave.example"),
    admin: await signInHeaders("admin@fluta.example"),
  };
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

describe("authorizeStoreMember", () => {
  it("rejects a request without a session", async () => {
    expect(await authorizeStoreMember(new Headers())).toMatchObject({ allowed: false, status: 401 });
  });

  it("returns the member's own store, role, and access", async () => {
    const result = await authorizeStoreMember(headers.staff);
    expect(result).toMatchObject({
      allowed: true,
      membership: { role: "STAFF" },
      store: { id: stores.freshFold },
      access: { canWorkOnExistingOrders: true },
    });
  });

  it("never gives a CleanWave user a FreshFold workspace, whatever the request names", async () => {
    const request = new Headers(headers.cleanWave);
    request.append("cookie", `storeId=${stores.freshFold}`);
    request.set("referer", `http://localhost:3000/overview?storeId=${stores.freshFold}`);
    const result = await authorizeStoreMember(request);
    expect(result).toMatchObject({ allowed: true, store: { id: stores.cleanWave } });
  });

  it("enforces the required role", async () => {
    expect(await authorizeStoreMember(headers.staff, { role: "OWNER" })).toMatchObject({
      allowed: false,
      status: 403,
      reason: "ROLE_NOT_PERMITTED",
    });
    expect(await authorizeStoreMember(headers.owner, { role: "OWNER" })).toMatchObject({ allowed: true });
  });

  it("rejects a deactivated membership on the next request, with the same session", async () => {
    const membership = await prisma.membership.findFirstOrThrow({
      where: { storeId: stores.freshFold, role: "STAFF", isActive: true },
    });
    expect(await authorizeStoreMember(headers.staff)).toMatchObject({ allowed: true });
    await prisma.membership.update({ where: { id: membership.id }, data: { isActive: false, deactivatedAt: new Date() } });
    try {
      expect(await authorizeStoreMember(headers.staff)).toMatchObject({
        allowed: false,
        status: 403,
        reason: "NO_ACTIVE_MEMBERSHIP",
      });
    } finally {
      await prisma.membership.update({ where: { id: membership.id }, data: { isActive: true, deactivatedAt: null } });
    }
  });

  it("rejects a store that a Fluta admin has deactivated", async () => {
    await prisma.store.update({ where: { id: stores.cleanWave }, data: { status: "DEACTIVATED" } });
    try {
      expect(await authorizeStoreMember(headers.cleanWave)).toMatchObject({ allowed: false, reason: "STORE_UNAVAILABLE" });
    } finally {
      await prisma.store.update({ where: { id: stores.cleanWave }, data: { status: "ACTIVE" } });
    }
  });

  it("gives a Fluta admin (no membership) no workspace", async () => {
    expect(await authorizeStoreMember(headers.admin)).toMatchObject({ allowed: false, reason: "NO_ACTIVE_MEMBERSHIP" });
  });
});

describe("authorizeFlutaAdmin", () => {
  it("rejects store staff and owners", async () => {
    for (const member of [headers.staff, headers.owner, headers.cleanWave]) {
      expect(await authorizeFlutaAdmin(member)).toMatchObject({ allowed: false, status: 403, reason: "NOT_FLUTA_ADMIN" });
    }
  });

  it("allows a Fluta admin", async () => {
    expect(await authorizeFlutaAdmin(headers.admin)).toMatchObject({ allowed: true, user: { email: "admin@fluta.example" } });
  });

  it("reads platformRole from the database on every call", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@fluta.example" } });
    await prisma.user.update({ where: { id: admin.id }, data: { platformRole: "USER" } });
    try {
      expect(await authorizeFlutaAdmin(headers.admin)).toMatchObject({ allowed: false, reason: "NOT_FLUTA_ADMIN" });
    } finally {
      await prisma.user.update({ where: { id: admin.id }, data: { platformRole: "FLUTA_ADMIN" } });
    }
  });
});

describe("createMembership", () => {
  it("refuses a second active membership", async () => {
    const staff = await prisma.user.findUniqueOrThrow({ where: { email: "kemi@freshfold.example" } });
    const result = await createMembership(stores.cleanWave, { userId: staff.id, role: "STAFF" }, prisma);
    expect(result).toEqual({ success: false, code: "ACTIVE_MEMBERSHIP_EXISTS" });
    expect(await prisma.membership.count({ where: { userId: staff.id } })).toBe(1);
  });
});
