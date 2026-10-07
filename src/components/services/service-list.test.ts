import { describe, expect, it } from "vitest";

import type { CatalogueService } from "@/types/services";

import {
  ALL_CATEGORIES,
  NO_CATEGORY,
  categoryOptions,
  categorySuggestions,
  filterServices,
  rememberSavedService,
  sortServices,
  withSavedServices,
} from "./service-list";

const UPDATED = new Date("2026-10-07T09:00:00Z");

function service(name: string, category: string | null, changes: Partial<CatalogueService> = {}): CatalogueService {
  return {
    id: name,
    name,
    category,
    pricingType: "PER_ITEM",
    price: 80_000,
    requiresQuote: false,
    isActive: true,
    updatedAt: UPDATED,
    ...changes,
  };
}

const at = (seconds: number) => new Date(UPDATED.getTime() + seconds * 1000);

const SERVICES = [
  service("Trousers", "Wash & iron"),
  service("Curtains", null),
  service("Bedding", "Household"),
  service("Shirt", "wash  & IRON"),
  service("Agbada", null),
  service("Dress", "Wash & iron"),
];

const names = (services: CatalogueService[]) => services.map((item) => item.name);

describe("sortServices", () => {
  it("sorts by category, then name, with uncategorised services last", () => {
    expect(names(sortServices(SERVICES))).toEqual(["Bedding", "Dress", "Shirt", "Trousers", "Agbada", "Curtains"]);
  });

  it("ignores case when sorting names", () => {
    expect(names(sortServices([service("b", null), service("A", null), service("a2", null)]))).toEqual(["A", "a2", "b"]);
  });
});

describe("categoryOptions", () => {
  it("lists each category once, ignoring case and extra spaces, then No category", () => {
    expect(categoryOptions(SERVICES)).toEqual([
      { value: ALL_CATEGORIES, label: "All categories" },
      { value: "category:household", label: "Household" },
      { value: "category:wash & iron", label: "Wash & iron" },
      { value: NO_CATEGORY, label: "No category" },
    ]);
    expect(categorySuggestions(SERVICES)).toEqual(["Household", "Wash & iron"]);
  });

  it("leaves out No category when every service has one", () => {
    expect(categoryOptions([service("Shirt", "Laundry")]).map((option) => option.value)).toEqual([
      ALL_CATEGORIES,
      "category:laundry",
    ]);
  });
});

describe("filterServices", () => {
  it("searches names ignoring case and extra spaces", () => {
    expect(names(filterServices(SERVICES, { query: "  SHI ", category: ALL_CATEGORIES }))).toEqual(["Shirt"]);
    expect(names(filterServices([service("Laundry  by weight", null)], { query: "laundry by", category: ALL_CATEGORIES }))).toEqual([
      "Laundry  by weight",
    ]);
  });

  it("filters by category, matching every spelling of it", () => {
    expect(names(filterServices(SERVICES, { query: "", category: "category:wash & iron" }))).toEqual([
      "Trousers",
      "Shirt",
      "Dress",
    ]);
    expect(names(filterServices(SERVICES, { query: "", category: NO_CATEGORY }))).toEqual(["Curtains", "Agbada"]);
  });

  it("combines search and category", () => {
    expect(names(filterServices(SERVICES, { query: "s", category: "category:wash & iron" }))).toEqual([
      "Trousers",
      "Shirt",
      "Dress",
    ]);
    expect(names(filterServices(SERVICES, { query: "bed", category: NO_CATEGORY }))).toEqual([]);
  });
});

describe("saved services", () => {
  const shirt = service("Shirt", "Wash & iron");
  const listed = [shirt, service("Dress", "Wash & iron")];

  it("shows a saved copy at once, before the server's refresh", () => {
    const disabled = { ...shirt, isActive: false, updatedAt: at(1) };
    const saved = rememberSavedService(new Map(), disabled, listed);
    expect(withSavedServices(listed, saved)[0]).toEqual(disabled);
  });

  it("shows a just-added service before the server lists it", () => {
    const added = service("Agbada", null, { updatedAt: at(1) });
    const saved = rememberSavedService(new Map(), added, listed);
    expect(names(withSavedServices(listed, saved))).toEqual(["Shirt", "Dress", "Agbada"]);
  });

  it("keeps the newest copy when an older refresh arrives after Undo", () => {
    const disabled = { ...shirt, isActive: false, updatedAt: at(1) };
    const enabled = { ...shirt, isActive: true, updatedAt: at(2) };
    let saved = rememberSavedService(new Map(), disabled, listed);
    saved = rememberSavedService(saved, enabled, listed);

    // The refresh from Disable arrives last.
    const staleRefresh = [disabled, listed[1]];
    expect(withSavedServices(staleRefresh, saved)[0]).toEqual(enabled);
  });

  it("keeps the newer saved copy when an older result arrives late", () => {
    const enabled = { ...shirt, isActive: true, updatedAt: at(2) };
    const saved = rememberSavedService(rememberSavedService(new Map(), enabled, listed), { ...shirt, isActive: false, updatedAt: at(1) }, listed);
    expect(saved.get("Shirt")).toEqual(enabled);
  });

  it("lets a newer server copy win, and drops saved copies the server has caught up with", () => {
    const disabled = { ...shirt, isActive: false, updatedAt: at(1) };
    let saved = rememberSavedService(new Map(), disabled, listed);

    const editedElsewhere = { ...shirt, name: "Shirt (pressed)", updatedAt: at(5) };
    const refreshed = [editedElsewhere, listed[1]];
    expect(withSavedServices(refreshed, saved)[0]).toEqual(editedElsewhere);

    saved = rememberSavedService(saved, { ...listed[1], price: 90_000, updatedAt: at(6) }, refreshed);
    expect([...saved.keys()]).toEqual(["Dress"]);
  });
});
