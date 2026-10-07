import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { addClosedDate, createServiceArea, saveSchedule, setFulfilmentOption } from "@/actions/fulfilment";
import { createService, disableService, updateService } from "@/actions/services";
import { removeStoreLogo, saveStoreBranding, saveStoreProfile } from "@/actions/store-settings";
import { POST as uploadLogo } from "@/app/api/v1/store/logo/route";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { FakeObjectStorage } from "@/test/fake-r2";
import { pngBytes } from "@/test/images";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { STORE_LOCKED_MESSAGE } from "./access";
import { requireStoreMember } from "./session";

// Every owner editing operation (Features 05, 06 and 07, Server Action or API
// route) checks requireOwnerCanEdit / authorizeOwnerCanEdit: an owner whose
// subscription is Cancelled can't change anything, nothing reaches the
// database or R2, and viewing is refused too (the Feature 03 membership gate).

const fakeR2 = vi.hoisted(() => ({ storage: undefined as FakeObjectStorage | undefined }));
vi.mock("@/server/integrations/r2", async () => {
  const { FakeObjectStorage } = await import("@/test/fake-r2");
  fakeR2.storage = new FakeObjectStorage();
  return { getObjectStorage: () => fakeR2.storage };
});
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const ORIGIN = process.env.BETTER_AUTH_URL ?? "";

let prisma: PrismaClient;
let freshFoldId: string;
let owner: Headers;

function r2(): FakeObjectStorage {
  if (!fakeR2.storage) throw new Error("fake R2 not created");
  return fakeR2.storage;
}

function upload(): Promise<Response> {
  const headers = new Headers(owner);
  headers.set("origin", ORIGIN);
  return uploadLogo(
    new Request(`${ORIGIN}/api/v1/store/logo`, { method: "POST", headers, body: new Blob([pngBytes(100, 100).slice()]) }),
  );
}

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

function setCancelled(cancelledAt: Date | null) {
  return prisma.subscription.update({ where: { storeId: freshFoldId }, data: { cancelledAt } });
}

// Everything an owner edit could change in FreshFold.
async function storeState() {
  const [store, services, areas, closedDates] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: freshFoldId } }),
    prisma.service.findMany({ where: { storeId: freshFoldId }, orderBy: { id: "asc" } }),
    prisma.serviceArea.findMany({ where: { storeId: freshFoldId }, orderBy: { id: "asc" } }),
    prisma.closedDate.findMany({ where: { storeId: freshFoldId }, orderBy: { id: "asc" } }),
  ]);
  return { store, services, areas, closedDates };
}

beforeAll(async () => {
  prisma = createTestPrisma();
  freshFoldId = (await prisma.store.findUniqueOrThrow({ where: { slug: "freshfold-laundry" } })).id;
  owner = await signInHeaders("ada@freshfold.example");
});

afterEach(async () => {
  await setCancelled(null);
  await prisma.store.update({ where: { id: freshFoldId }, data: { logoKey: null } });
  r2().reset();
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

describe("an owner whose subscription is Cancelled", () => {
  it("cannot save store settings, services, or fulfilment settings", async () => {
    await setCancelled(new Date());
    const shirt = await prisma.service.findFirstOrThrow({ where: { storeId: freshFoldId, name: "Shirt" } });
    const before = await storeState();
    request.headers = owner;

    const results = await Promise.all([
      // Feature 05
      saveStoreProfile(form({ name: "Renamed", description: "", address: "", phone: "", email: "" })),
      saveStoreBranding(form({ primaryColor: "#123456", accentColor: "" })),
      // Feature 06
      createService(form({ name: "Silk scarf", category: "", pricingType: "PER_ITEM", price: "1,200", requiresQuote: "" })),
      updateService(shirt.id, form({ name: "Shirt 2", category: "", pricingType: "PER_ITEM", price: "900", requiresQuote: "" })),
      disableService(shirt.id),
      // Feature 07
      setFulfilmentOption("dropOffEnabled", false),
      saveSchedule(form({ activeDays: ["1"], openTime: "10:00", closeTime: "12:00" })),
      createServiceArea(form({ name: "Karu", chargeType: "FIXED", fixedCharge: "500" })),
      addClosedDate(form({ date: "2099-06-15", note: "" })),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, message: STORE_LOCKED_MESSAGE });

    expect(await storeState()).toEqual(before);
  });

  it("cannot upload a logo: 403 with the same message, and nothing is written to R2", async () => {
    await setCancelled(new Date());
    request.headers = owner;

    const response = await upload();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, message: STORE_LOCKED_MESSAGE });
    expect(r2().objects.size).toBe(0);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: freshFoldId } })).logoKey).toBeNull();
  });

  it("cannot remove a logo: the key and the file stay", async () => {
    request.headers = owner;
    expect((await upload()).status).toBe(200);
    const { logoKey } = await prisma.store.findUniqueOrThrow({ where: { id: freshFoldId } });
    expect(logoKey).not.toBeNull();

    await setCancelled(new Date());
    expect(await removeStoreLogo()).toEqual({ ok: false, message: STORE_LOCKED_MESSAGE });
    expect((await prisma.store.findUniqueOrThrow({ where: { id: freshFoldId } })).logoKey).toBe(logoKey);
    expect([...r2().objects.keys()]).toEqual([logoKey]);
  });

  it("is refused viewing too, as before (the membership gate)", async () => {
    await setCancelled(new Date());
    request.headers = owner;
    expect(await requireStoreMember({ role: "OWNER" })).toMatchObject({
      allowed: false,
      status: 403,
      reason: "STORE_UNAVAILABLE",
    });
  });

  it("can edit again once the subscription is no longer cancelled", async () => {
    request.headers = owner;
    expect(await setFulfilmentOption("dropOffEnabled", true)).toMatchObject({ ok: true });
  });
});
