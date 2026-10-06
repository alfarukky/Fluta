import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/server/data/client";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import { saveStoreBranding, saveStoreProfile } from "./store-settings";

// The actions read the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const SETTINGS_FIELDS = {
  name: true,
  description: true,
  addressText: true,
  phone: true,
  email: true,
  brandPrimaryColor: true,
  brandAccentColor: true,
} as const;

let prisma: PrismaClient;
let stores: { freshFold: string; cleanWave: string };
let signedIn: Record<"owner" | "staff" | "cleanWaveOwner", Headers>;
let originals: Awaited<ReturnType<typeof readSettings>>[];

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
  originals = await Promise.all([readSettings(stores.freshFold), readSettings(stores.cleanWave)]);
});

afterEach(async () => {
  for (const { id, ...data } of originals) await prisma.store.update({ where: { id }, data });
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

function readSettings(storeId: string) {
  return prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { id: true, ...SETTINGS_FIELDS } });
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const PROFILE = {
  name: "FreshFold Laundry & Dry Cleaning",
  description: "Wash, dry and fold in Lekki.",
  address: "12 Admiralty Way, Lekki Phase 1, Lagos",
  phone: "0803 123 4521",
  email: "Hello@FreshFold.example",
};

describe("saveStoreProfile", () => {
  it("saves the owner's store, with the phone in E.164", async () => {
    request.headers = signedIn.owner;
    const result = await saveStoreProfile(form(PROFILE));
    expect(result).toMatchObject({ ok: true, values: { phone: "+234 803 123 4521", email: "hello@freshfold.example" } });
    expect(await readSettings(stores.freshFold)).toMatchObject({
      name: PROFILE.name,
      description: PROFILE.description,
      addressText: PROFILE.address,
      phone: "+2348031234521",
      email: "hello@freshfold.example",
    });
  });

  it("refuses staff and saves nothing", async () => {
    request.headers = signedIn.staff;
    expect(await saveStoreProfile(form(PROFILE))).toMatchObject({ ok: false });
    expect(await readSettings(stores.freshFold)).toEqual(originals[0]);
  });

  it("never lets a FreshFold owner change CleanWave, even when the form names CleanWave", async () => {
    request.headers = signedIn.owner;
    const result = await saveStoreProfile(
      form({ ...PROFILE, name: "Renamed by FreshFold", storeId: stores.cleanWave, id: stores.cleanWave }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(await readSettings(stores.cleanWave)).toEqual(originals[1]);
    expect(await readSettings(stores.freshFold)).toMatchObject({ name: "Renamed by FreshFold" });
  });

  it("rejects invalid values and saves nothing", async () => {
    request.headers = signedIn.owner;
    const invalid = [
      { name: "F" },
      { name: "x".repeat(81) },
      { description: "x".repeat(301) },
      { address: "x".repeat(201) },
      { phone: "12345" },
      { email: "not-an-email" },
    ];
    for (const change of invalid) {
      const result = await saveStoreProfile(form({ ...PROFILE, ...change }));
      expect(result, JSON.stringify(change)).toMatchObject({ ok: false, fieldErrors: { [Object.keys(change)[0]]: expect.any(String) } });
    }
    expect(await readSettings(stores.freshFold)).toEqual(originals[0]);
  });
});

describe("saveStoreBranding", () => {
  it("saves #RRGGBB colours for the owner's store", async () => {
    request.headers = signedIn.owner;
    expect(await saveStoreBranding(form({ primaryColor: "#1a56b0", accentColor: "" }))).toMatchObject({ ok: true });
    expect(await readSettings(stores.freshFold)).toMatchObject({ brandPrimaryColor: "#1A56B0", brandAccentColor: null });
  });

  it("refuses staff and saves nothing", async () => {
    request.headers = signedIn.staff;
    expect(await saveStoreBranding(form({ primaryColor: "#1A56B0", accentColor: "#FFEB3B" }))).toMatchObject({ ok: false });
    expect(await readSettings(stores.freshFold)).toEqual(originals[0]);
  });

  it("rejects anything but #RRGGBB and saves nothing", async () => {
    request.headers = signedIn.owner;
    for (const primaryColor of ["red", "#FFF", "#1A56B0; color: red", "url(x)"]) {
      expect(await saveStoreBranding(form({ primaryColor, accentColor: "#FFEB3B" }))).toMatchObject({ ok: false });
    }
    expect(await readSettings(stores.freshFold)).toEqual(originals[0]);
  });

  it("only ever changes the signed-in owner's store", async () => {
    request.headers = signedIn.cleanWaveOwner;
    const result = await saveStoreBranding(
      form({ primaryColor: "#E91E63", accentColor: "#FFEB3B", storeId: stores.freshFold }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(await readSettings(stores.freshFold)).toEqual(originals[0]);
    expect(await readSettings(stores.cleanWave)).toMatchObject({ brandPrimaryColor: "#E91E63" });
  });
});
