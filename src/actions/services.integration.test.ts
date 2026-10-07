import { isDeepStrictEqual } from "node:util";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { PrismaClient, Service } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { createService, disableService, enableService, updateService } from "./services";

// The actions read the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let prisma: PrismaClient;
let stores: { freshFold: string; cleanWave: string };
let signedIn: Record<"owner" | "staff" | "cleanWaveOwner", Headers>;
// Every seeded service in both stores, restored after each test.
let seeded: Service[];

beforeAll(async () => {
  prisma = createTestPrisma();
  const [freshFold, cleanWave] = await Promise.all(
    ["freshfold-laundry", "cleanwave-laundry"].map((slug) => prisma.store.findUniqueOrThrow({ where: { slug } })),
  );
  stores = { freshFold: freshFold.id, cleanWave: cleanWave.id };
  signedIn = {
    owner: await signInHeaders("ada@freshfold.example"),
    staff: await signInHeaders("kemi@freshfold.example"),
    cleanWaveOwner: await signInHeaders("musa@cleanwave.example"),
  };
  seeded = await readServices();
});

// Puts changed seeded services back and removes any the test created. (The
// app never deletes services; only test cleanup does, and only services it
// made.)
afterEach(async () => {
  const seededIds = seeded.map((service) => service.id);
  await prisma.service.deleteMany({ where: { storeId: { in: Object.values(stores) }, id: { notIn: seededIds } } });

  const current = new Map((await readServices()).map((service) => [service.id, editable(service)]));
  const changed = seeded.filter((service) => !isDeepStrictEqual(current.get(service.id), editable(service)));
  // Move changed names out of the way first, so swapping names back can't collide.
  for (const { id } of changed) {
    await prisma.service.update({ where: { id }, data: { nameKey: `restoring ${id}` } });
  }
  for (const service of changed) {
    await prisma.service.update({ where: { id: service.id }, data: editable(service) });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

function readServices() {
  return prisma.service.findMany({ where: { storeId: { in: Object.values(stores) } }, orderBy: { id: "asc" } });
}

function seededService(store: keyof typeof stores, name: string): Service {
  const service = seeded.find((candidate) => candidate.storeId === stores[store] && candidate.name === name);
  if (!service) throw new Error(`No seeded service ${name}`);
  return service;
}

function readService(id: string) {
  return prisma.service.findUniqueOrThrow({ where: { id } });
}

// The fields the app can change, so a before/after comparison ignores
// updatedAt (which the cleanup above also bumps).
function editable({ name, nameKey, category, pricingType, price, requiresQuote, isActive, storeId }: Service) {
  return { name, nameKey, category, pricingType, price, requiresQuote, isActive, storeId };
}

const SILK_SCARF = { name: "Silk scarf", category: "Delicates", pricingType: "PER_ITEM", price: "1,200", requiresQuote: "" };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function createAsOwner(values: Record<string, string>) {
  request.headers = signedIn.owner;
  const result = await createService(form(values));
  if (!result.ok) throw new Error(`createService failed: ${result.message}`);
  return result.service;
}

describe("access", () => {
  it("refuses staff: they cannot create, edit, disable or enable services", async () => {
    const shirt = seededService("freshFold", "Shirt");
    request.headers = signedIn.staff;

    expect(await createService(form(SILK_SCARF))).toMatchObject({ ok: false });
    expect(await updateService(shirt.id, form({ ...SILK_SCARF, name: "Shirt (staff)" }))).toMatchObject({ ok: false });
    expect(await disableService(shirt.id)).toMatchObject({ ok: false });
    expect(await enableService(shirt.id)).toMatchObject({ ok: false });

    expect((await readServices()).map(editable)).toEqual(seeded.map(editable));
  });

  it("never lets a FreshFold owner change a CleanWave service, even by sending its ID", async () => {
    const cleanWaveSuit = seededService("cleanWave", "Suit");
    request.headers = signedIn.owner;

    const edit = form({ ...SILK_SCARF, name: "Suit (changed)", storeId: stores.cleanWave });
    expect(await updateService(cleanWaveSuit.id, edit)).toMatchObject({ ok: false });
    expect(await disableService(cleanWaveSuit.id)).toMatchObject({ ok: false });
    expect(editable(await readService(cleanWaveSuit.id))).toEqual(editable(cleanWaveSuit));

    // A store ID in the form is ignored: the service goes to the owner's own store.
    const result = await createService(form({ ...SILK_SCARF, storeId: stores.cleanWave }));
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && (await readService(result.service.id)).storeId).toBe(stores.freshFold);
  });
});

describe("per-kg services", () => {
  it("are always saved with quote required, even if the request says otherwise", async () => {
    const created = await createAsOwner({ ...SILK_SCARF, name: "Duvet by weight", pricingType: "PER_KG", requiresQuote: "" });
    expect(await readService(created.id)).toMatchObject({ pricingType: "PER_KG", requiresQuote: true });

    const scarf = await createAsOwner(SILK_SCARF);
    const result = await updateService(scarf.id, form({ ...SILK_SCARF, pricingType: "PER_KG", requiresQuote: "false" }));
    expect(result).toMatchObject({ ok: true, service: { requiresQuote: true } });
    expect(await readService(scarf.id)).toMatchObject({ pricingType: "PER_KG", requiresQuote: true });
  });
});

describe("duplicate names", () => {
  it("are rejected within a store, ignoring case and extra spaces", async () => {
    request.headers = signedIn.owner;
    const result = await createService(form({ ...SILK_SCARF, name: "  SHIRT " }));
    expect(result).toEqual({
      ok: false,
      message: "A service with this name already exists.",
      fieldErrors: { name: "A service with this name already exists." },
    });

    const trousers = seededService("freshFold", "Trousers");
    expect(await updateService(trousers.id, form({ ...SILK_SCARF, name: "shirt" }))).toMatchObject({ ok: false });
    expect((await readServices()).map(editable)).toEqual(seeded.map(editable));
  });

  it("are rejected against disabled services, with a hint to re-enable", async () => {
    const scarf = await createAsOwner(SILK_SCARF);
    expect(await disableService(scarf.id)).toMatchObject({ ok: true });

    const result = await createService(form({ ...SILK_SCARF, name: "silk   SCARF" }));
    expect(result).toMatchObject({
      ok: false,
      message: "A disabled service with this name exists. Re-enable it instead.",
    });
  });

  it("are allowed across stores", async () => {
    request.headers = signedIn.cleanWaveOwner;
    const result = await createService(form({ ...SILK_SCARF, name: "Trousers" }));
    expect(result).toMatchObject({ ok: true, service: { name: "Trousers" } });
  });

  it("still keep the service when renamed to its own name in a different case", async () => {
    const scarf = await createAsOwner(SILK_SCARF);
    expect(await updateService(scarf.id, form({ ...SILK_SCARF, name: "Silk Scarf" }))).toMatchObject({ ok: true });
    expect(await readService(scarf.id)).toMatchObject({ name: "Silk Scarf", nameKey: "silk scarf" });
  });

  it("two identical create requests sent at once produce exactly one service", async () => {
    request.headers = signedIn.owner;
    const results = await Promise.all([createService(form(SILK_SCARF)), createService(form(SILK_SCARF))]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ message: "A service with this name already exists." });
    expect(await prisma.service.count({ where: { storeId: stores.freshFold, nameKey: "silk scarf" } })).toBe(1);
  });
});

describe("categories", () => {
  it("a new category differing only in case or spacing is saved with the existing spelling", async () => {
    const created = await createAsOwner({ ...SILK_SCARF, category: "  WASH   & iron " });
    expect(await readService(created.id)).toMatchObject({ category: "Wash & iron" });
  });

  it("a whitespace-only category is saved as NULL", async () => {
    const created = await createAsOwner({ ...SILK_SCARF, category: "    " });
    expect(await readService(created.id)).toMatchObject({ category: null });
  });

  it("a new category is saved as typed (trimmed)", async () => {
    const created = await createAsOwner({ ...SILK_SCARF, category: " Delicates " });
    expect(await readService(created.id)).toMatchObject({ category: "Delicates" });
  });
});

describe("existing orders", () => {
  it("editing or disabling a service leaves every existing order line unchanged", async () => {
    const lines = () =>
      prisma.orderLine.findMany({ where: { storeId: stores.freshFold }, orderBy: { id: "asc" } });
    const before = await lines();
    const trousers = seededService("freshFold", "Trousers");
    expect(before.some((line) => line.serviceId === trousers.id)).toBe(true);

    request.headers = signedIn.owner;
    const edit = { name: "Trousers (pressed)", category: "Pressing", pricingType: "PER_PACKAGE", price: "1,750.50", requiresQuote: "on" };
    expect(await updateService(trousers.id, form(edit))).toMatchObject({ ok: true });
    expect(await disableService(trousers.id)).toMatchObject({ ok: true });
    expect(await readService(trousers.id)).toMatchObject({
      name: "Trousers (pressed)",
      pricingType: "PER_PACKAGE",
      price: 175_050,
      requiresQuote: true,
      isActive: false,
    });

    expect(await lines()).toEqual(before);
  });
});

describe("disabling", () => {
  it("a disabled service can be re-enabled, and nothing is ever deleted", async () => {
    const shirt = seededService("freshFold", "Shirt");
    request.headers = signedIn.owner;

    expect(await disableService(shirt.id)).toMatchObject({ ok: true, service: { isActive: false } });
    expect(await readService(shirt.id)).toMatchObject({ isActive: false });
    expect(await enableService(shirt.id)).toMatchObject({ ok: true, service: { isActive: true } });

    expect((await readServices()).map(editable)).toEqual(seeded.map(editable));
  });

  it("rejects an unknown service ID", async () => {
    request.headers = signedIn.owner;
    expect(await disableService("not-a-service")).toMatchObject({ ok: false });
    expect(await enableService("")).toMatchObject({ ok: false });
  });
});
