import { isDeepStrictEqual } from "node:util";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ClosedDate, PrismaClient, ServiceArea, Store } from "@/generated/prisma/client";
import { getLocalDateKey } from "@/lib/time";
import { getPrisma } from "@/server/data/client";
import { loadFulfilmentSettings } from "@/server/services/fulfilment-settings";
import { signInHeaders } from "@/test/integration/auth";
import { createTestPrisma } from "@/test/integration/db";

import {
  addClosedDate,
  createServiceArea,
  disableServiceArea,
  enableServiceArea,
  removeClosedDate,
  saveSchedule,
  setFulfilmentOption,
  updateServiceArea,
} from "./fulfilment";

// The actions read the session from next/headers; here it's the headers of
// whoever the test signed in as.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let prisma: PrismaClient;
let stores: { freshFold: string; cleanWave: string };
let signedIn: Record<"owner" | "staff" | "cleanWaveOwner", Headers>;
// Seeded rows in both stores, restored after each test.
let seededStores: Store[];
let seededAreas: ServiceArea[];
let seededClosedDates: ClosedDate[];

const STORE_FIELDS = ["dropOffEnabled", "pickupDeliveryEnabled", "activeDays", "openTime", "closeTime"] as const;

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
  [seededStores, seededAreas, seededClosedDates] = await Promise.all([readStores(), readAreas(), readClosedDates()]);
});

// Puts changed seeded rows back and removes any the test created. (The app
// never deletes areas; only test cleanup does, and only areas it made.)
afterEach(async () => {
  const storeIds = Object.values(stores);
  await prisma.serviceArea.deleteMany({
    where: { storeId: { in: storeIds }, id: { notIn: seededAreas.map((area) => area.id) } },
  });
  await prisma.closedDate.deleteMany({
    where: { storeId: { in: storeIds }, id: { notIn: seededClosedDates.map((closed) => closed.id) } },
  });
  const currentDates = new Set((await readClosedDates()).map((closed) => closed.id));
  const missing = seededClosedDates.filter((closed) => !currentDates.has(closed.id));
  if (missing.length > 0) await prisma.closedDate.createMany({ data: missing });

  const current = new Map((await readAreas()).map((area) => [area.id, editableArea(area)]));
  const changed = seededAreas.filter((area) => !isDeepStrictEqual(current.get(area.id), editableArea(area)));
  // Move changed names out of the way first, so swapping names back can't collide.
  for (const { id } of changed) {
    await prisma.serviceArea.update({ where: { id }, data: { nameKey: `restoring ${id}` } });
  }
  for (const area of changed) await prisma.serviceArea.update({ where: { id: area.id }, data: editableArea(area) });

  for (const store of seededStores) {
    await prisma.store.update({ where: { id: store.id }, data: storeSettings(store) });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  await getPrisma().$disconnect();
});

function readStores() {
  return prisma.store.findMany({ where: { id: { in: Object.values(stores) } }, orderBy: { id: "asc" } });
}

function readAreas() {
  return prisma.serviceArea.findMany({ where: { storeId: { in: Object.values(stores) } }, orderBy: { id: "asc" } });
}

function readClosedDates() {
  return prisma.closedDate.findMany({ where: { storeId: { in: Object.values(stores) } }, orderBy: { id: "asc" } });
}

function storeSettings(store: Store) {
  return Object.fromEntries(STORE_FIELDS.map((field) => [field, store[field]])) as Pick<
    Store,
    (typeof STORE_FIELDS)[number]
  >;
}

// The fields the app can change, so a before/after comparison ignores updatedAt.
function editableArea({ name, nameKey, chargeType, fixedCharge, isActive, storeId }: ServiceArea) {
  return { name, nameKey, chargeType, fixedCharge, isActive, storeId };
}

function seededArea(store: keyof typeof stores, name: string): ServiceArea {
  const area = seededAreas.find((candidate) => candidate.storeId === stores[store] && candidate.name === name);
  if (!area) throw new Error(`No seeded area ${name}`);
  return area;
}

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

async function snapshot() {
  const [storeRows, areas, closedDates] = await Promise.all([readStores(), readAreas(), readClosedDates()]);
  return { stores: storeRows.map(storeSettings), areas: areas.map(editableArea), closedDates };
}

const KARU = { name: "Karu", chargeType: "FIXED", fixedCharge: "1,500" };
// A date safely in the future in any time zone.
const FUTURE_DATE = "2099-06-15";

describe("access", () => {
  it("refuses staff: they cannot change any fulfilment setting", async () => {
    const lekki = seededArea("freshFold", "Lekki Phase 1");
    const christmas = seededClosedDates.find((closed) => closed.storeId === stores.freshFold);
    const before = await snapshot();
    request.headers = signedIn.staff;

    const results = await Promise.all([
      setFulfilmentOption("dropOffEnabled", false),
      setFulfilmentOption("pickupDeliveryEnabled", false),
      saveSchedule(form({ activeDays: ["1"], openTime: "10:00", closeTime: "12:00" })),
      createServiceArea(form(KARU)),
      updateServiceArea(lekki.id, form({ ...KARU, name: "Lekki (staff)" })),
      disableServiceArea(lekki.id),
      enableServiceArea(lekki.id),
      addClosedDate(form({ date: FUTURE_DATE, note: "" })),
      removeClosedDate(christmas?.id ?? "none"),
    ]);
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, message: "Only the store owner can change fulfilment settings." });
    }

    expect(await snapshot()).toEqual(before);
  });

  it("never lets a FreshFold owner change a CleanWave area or closed date, even by sending its ID", async () => {
    const wuse = seededArea("cleanWave", "Wuse 2");
    request.headers = signedIn.cleanWaveOwner;
    const added = await addClosedDate(form({ date: FUTURE_DATE, note: "CleanWave closed" }));
    if (!added.ok) throw new Error(added.message);
    const before = await snapshot();

    request.headers = signedIn.owner;
    expect(await updateServiceArea(wuse.id, form({ ...KARU, storeId: stores.cleanWave }))).toMatchObject({ ok: false });
    expect(await disableServiceArea(wuse.id)).toMatchObject({ ok: false });
    expect(await enableServiceArea(wuse.id)).toMatchObject({ ok: false });
    expect(await removeClosedDate(added.closedDate.id)).toMatchObject({ ok: false });
    expect(await snapshot()).toEqual(before);

    // A store ID in the form is ignored: the area goes to the owner's own store.
    const created = await createServiceArea(form({ ...KARU, storeId: stores.cleanWave }));
    expect(created).toMatchObject({ ok: true });
    const area = await prisma.serviceArea.findUniqueOrThrow({ where: { id: created.ok ? created.area.id : "" } });
    expect(area.storeId).toBe(stores.freshFold);
  });
});

describe("reading settings", () => {
  it("loads only the owner's own store: areas and closed dates from another store never appear", async () => {
    const now = new Date();
    const freshFold = await loadFulfilmentSettings(stores.freshFold, "Africa/Lagos", now);
    const cleanWave = await loadFulfilmentSettings(stores.cleanWave, "Africa/Lagos", now);

    const areaIds = (storeId: string) => seededAreas.filter((area) => area.storeId === storeId).map((area) => area.id).sort();
    expect(freshFold.areas.map((area) => area.id).sort()).toEqual(areaIds(stores.freshFold));
    expect(cleanWave.areas.map((area) => area.id).sort()).toEqual(areaIds(stores.cleanWave));

    request.headers = signedIn.cleanWaveOwner;
    const added = await addClosedDate(form({ date: FUTURE_DATE, note: "CleanWave only" }));
    if (!added.ok) throw new Error(added.message);
    const reloaded = await loadFulfilmentSettings(stores.freshFold, "Africa/Lagos", now);
    expect(reloaded.closedDates.map((closed) => closed.id)).not.toContain(added.closedDate.id);
  });

  it("lists upcoming closed dates only (from today in the store's time zone), soonest first", async () => {
    const now = new Date();
    const today = getLocalDateKey(now, "Africa/Lagos");
    // Written directly: the app refuses past dates.
    await prisma.closedDate.createMany({
      data: [
        { storeId: stores.freshFold, date: new Date("2020-01-01T00:00:00Z"), note: "Past" },
        { storeId: stores.freshFold, date: new Date(`${FUTURE_DATE}T00:00:00Z`), note: "Later" },
        { storeId: stores.freshFold, date: new Date(`${today}T00:00:00Z`), note: "Today" },
      ],
    });

    const { closedDates } = await loadFulfilmentSettings(stores.freshFold, "Africa/Lagos", now);
    const dates = closedDates.map((closed) => closed.date);
    expect(dates).toContain(today);
    expect(dates).toContain(FUTURE_DATE);
    expect(dates).not.toContain("2020-01-01");
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe(today);
  });
});

describe("fulfilment options", () => {
  it("refuses turning off both options, in the action", async () => {
    request.headers = signedIn.owner;
    expect(await setFulfilmentOption("dropOffEnabled", false)).toMatchObject({ ok: true });
    const refused = await setFulfilmentOption("pickupDeliveryEnabled", false);
    expect(refused).toMatchObject({ ok: false, options: { dropOffEnabled: false, pickupDeliveryEnabled: true } });
    expect(refused.ok ? "" : refused.message).toMatch(/at least one/i);

    expect(await setFulfilmentOption("dropOffEnabled", true)).toMatchObject({ ok: true });
    expect(await setFulfilmentOption("pickupDeliveryEnabled", false)).toMatchObject({
      ok: true,
      options: { dropOffEnabled: true, pickupDeliveryEnabled: false },
      pickupAvailable: false,
    });
  });

  it("two requests at once can't turn both options off", async () => {
    request.headers = signedIn.owner;
    const results = await Promise.all([
      setFulfilmentOption("dropOffEnabled", false),
      setFulfilmentOption("pickupDeliveryEnabled", false),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: stores.freshFold } });
    expect(store.dropOffEnabled || store.pickupDeliveryEnabled).toBe(true);
  });

  it("refuses turning off both options, in the database", async () => {
    await expect(
      prisma.store.update({
        where: { id: stores.freshFold },
        data: { dropOffEnabled: false, pickupDeliveryEnabled: false },
      }),
    ).rejects.toThrow(/Store_fulfilment_option_check/);
  });
});

describe("service areas", () => {
  it("saves a fixed charge in kobo, ₦0 as free, and a quote-required area without a charge", async () => {
    request.headers = signedIn.owner;
    expect(await createServiceArea(form({ name: "  Wuse   2 ", chargeType: "FIXED", fixedCharge: "₦1,500.50" }))).toMatchObject({
      ok: true,
      area: { name: "Wuse   2", chargeType: "FIXED", fixedCharge: 150_050, isActive: true },
    });
    expect(await createServiceArea(form({ name: "Garki", chargeType: "FIXED", fixedCharge: "0" }))).toMatchObject({
      ok: true,
      area: { fixedCharge: 0 },
    });
    expect(
      await createServiceArea(form({ name: "Gwarinpa", chargeType: "QUOTE_REQUIRED", fixedCharge: "" })),
    ).toMatchObject({ ok: true, area: { chargeType: "QUOTE_REQUIRED", fixedCharge: null } });

    const wuse = await prisma.serviceArea.findFirstOrThrow({ where: { storeId: stores.freshFold, name: "Wuse   2" } });
    expect(wuse.nameKey).toBe("wuse 2");
  });

  it("refuses a Fixed area without a charge or a Quote-required area with one, in the action", async () => {
    request.headers = signedIn.owner;
    const before = await snapshot();
    expect(await createServiceArea(form({ name: "Karu", chargeType: "FIXED", fixedCharge: "" }))).toMatchObject({
      ok: false,
      fieldErrors: { fixedCharge: expect.any(String) },
    });
    expect(
      await createServiceArea(form({ name: "Karu", chargeType: "QUOTE_REQUIRED", fixedCharge: "500" })),
    ).toMatchObject({ ok: false, fieldErrors: { fixedCharge: expect.any(String) } });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a Fixed area without a charge or a Quote-required area with one, in the database", async () => {
    const base = { storeId: stores.freshFold, name: "Karu", nameKey: "karu" };
    await expect(
      prisma.serviceArea.create({ data: { ...base, chargeType: "FIXED", fixedCharge: null } }),
    ).rejects.toThrow(/ServiceArea_charge_check/);
    await expect(
      prisma.serviceArea.create({ data: { ...base, chargeType: "FIXED", fixedCharge: -100 } }),
    ).rejects.toThrow(/ServiceArea_charge_check/);
    await expect(
      prisma.serviceArea.create({ data: { ...base, chargeType: "QUOTE_REQUIRED", fixedCharge: 500 } }),
    ).rejects.toThrow(/ServiceArea_charge_check/);

    const ajah = seededArea("freshFold", "Ajah");
    await expect(prisma.serviceArea.update({ where: { id: ajah.id }, data: { fixedCharge: 500 } })).rejects.toThrow(
      /ServiceArea_charge_check/,
    );
  });

  it("refuses duplicate names within a store, ignoring case and spaces, including disabled areas", async () => {
    request.headers = signedIn.owner;
    expect(await createServiceArea(form({ ...KARU, name: " lekki   PHASE 1 " }))).toMatchObject({
      ok: false,
      fieldErrors: { name: "An area with this name already exists." },
    });

    const ajah = seededArea("freshFold", "Ajah");
    expect(await disableServiceArea(ajah.id)).toMatchObject({ ok: true, area: { isActive: false } });
    expect(await createServiceArea(form({ ...KARU, name: "AJAH" }))).toMatchObject({
      ok: false,
      fieldErrors: { name: "A disabled area with this name exists. Re-enable it instead." },
    });

    // Renaming an area onto another's name is refused too.
    const lekki = seededArea("freshFold", "Lekki Phase 1");
    expect(await updateServiceArea(lekki.id, form({ ...KARU, name: "ajah" }))).toMatchObject({ ok: false });

    // Another store may use the same name.
    request.headers = signedIn.cleanWaveOwner;
    expect(await createServiceArea(form({ ...KARU, name: "Ajah" }))).toMatchObject({ ok: true });
  });

  it("lets an area change the case or spacing of its own name", async () => {
    request.headers = signedIn.owner;
    const lekki = seededArea("freshFold", "Lekki Phase 1");
    expect(
      await updateServiceArea(lekki.id, form({ name: "LEKKI  phase 1", chargeType: "FIXED", fixedCharge: "1,000" })),
    ).toMatchObject({ ok: true, area: { id: lekki.id, name: "LEKKI  phase 1" } });
  });

  it("two identical create requests at once produce one area", async () => {
    request.headers = signedIn.owner;
    const results = await Promise.all([createServiceArea(form(KARU)), createServiceArea(form(KARU))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await prisma.serviceArea.count({ where: { storeId: stores.freshFold, nameKey: "karu" } })).toBe(1);
  });

  it("disables and re-enables an area without deleting it", async () => {
    request.headers = signedIn.owner;
    const lekki = seededArea("freshFold", "Lekki Phase 1");
    expect(await disableServiceArea(lekki.id)).toMatchObject({ ok: true, area: { id: lekki.id, isActive: false } });
    expect(await enableServiceArea(lekki.id)).toMatchObject({ ok: true, area: { id: lekki.id, isActive: true } });
    expect(editableArea(await prisma.serviceArea.findUniqueOrThrow({ where: { id: lekki.id } }))).toEqual(
      editableArea(lekki),
    );
  });
});

describe("schedule and closed dates", () => {
  it("saves active days sorted and hours as entered, and reports pickup availability", async () => {
    request.headers = signedIn.owner;
    expect(await saveSchedule(form({ activeDays: ["6", "1", "3"], openTime: "07:45", closeTime: "17:15" }))).toMatchObject({
      ok: true,
      schedule: { activeDays: [1, 3, 6], openTime: "07:45", closeTime: "17:15" },
      pickupAvailable: true,
    });

    expect(await saveSchedule(form({ activeDays: [], openTime: "08:00", closeTime: "17:00" }))).toMatchObject({
      ok: false,
      fieldErrors: { activeDays: expect.any(String) },
    });
    expect(await saveSchedule(form({ activeDays: ["1"], openTime: "18:00", closeTime: "08:00" }))).toMatchObject({
      ok: false,
      fieldErrors: { closeTime: expect.any(String) },
    });
    expect(await prisma.store.findUniqueOrThrow({ where: { id: stores.freshFold } })).toMatchObject({
      activeDays: [1, 3, 6],
      openTime: "07:45",
      closeTime: "17:15",
    });
  });

  it("adds a closed date from today in the store's time zone, refuses past dates and the same date twice", async () => {
    request.headers = signedIn.owner;
    const today = getLocalDateKey(new Date(), "Africa/Lagos");
    expect(await addClosedDate(form({ date: today, note: " Stocktake " }))).toMatchObject({
      ok: true,
      closedDate: { date: today, note: "Stocktake" },
    });
    expect(await addClosedDate(form({ date: today, note: "" }))).toMatchObject({
      ok: false,
      message: "This date is already closed.",
    });
    expect(await addClosedDate(form({ date: "2020-01-01", note: "" }))).toMatchObject({
      ok: false,
      fieldErrors: { date: expect.any(String) },
    });
    expect(await prisma.closedDate.count({ where: { storeId: stores.freshFold, date: new Date(`${today}T00:00:00Z`) } })).toBe(1);
  });

  it("removes a closed date", async () => {
    request.headers = signedIn.owner;
    const added = await addClosedDate(form({ date: FUTURE_DATE, note: "" }));
    if (!added.ok) throw new Error(added.message);
    expect(await removeClosedDate(added.closedDate.id)).toMatchObject({ ok: true });
    expect(await removeClosedDate(added.closedDate.id)).toMatchObject({ ok: false });
    expect(await prisma.closedDate.findUnique({ where: { id: added.closedDate.id } })).toBeNull();
  });
});

describe("existing orders", () => {
  it("editing or disabling an area leaves every existing order unchanged", async () => {
    // Whole rows: area link, fulfilment type and charge, and everything else.
    const orders = () => prisma.order.findMany({ where: { storeId: stores.freshFold }, orderBy: { id: "asc" } });
    const before = await orders();
    const lekki = seededArea("freshFold", "Lekki Phase 1");
    expect(before.some((order) => order.serviceAreaId === lekki.id)).toBe(true);

    request.headers = signedIn.owner;
    expect(await updateServiceArea(lekki.id, form({ name: "Lekki", chargeType: "QUOTE_REQUIRED", fixedCharge: "" }))).toMatchObject({
      ok: true,
    });
    expect(await disableServiceArea(lekki.id)).toMatchObject({ ok: true });
    expect(await setFulfilmentOption("pickupDeliveryEnabled", false)).toMatchObject({ ok: true });

    expect(await orders()).toEqual(before);
  });
});
