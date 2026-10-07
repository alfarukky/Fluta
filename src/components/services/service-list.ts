import { toMatchKey } from "@/lib/match-key";
import type { CatalogueService } from "@/types/services";

// Sorting, searching and the category filter for the services page. Category
// and name matching ignore case and extra spaces (toMatchKey).

export const ALL_CATEGORIES = "all";
export const NO_CATEGORY = "none";

export interface CategoryOption {
  // ALL_CATEGORIES, NO_CATEGORY, or "category:" + the category's match key.
  value: string;
  label: string;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

// By category, then name; services without a category last.
export function sortServices(services: readonly CatalogueService[]): CatalogueService[] {
  return [...services].sort((a, b) => {
    if (a.category === null || b.category === null) {
      if (a.category !== b.category) return a.category === null ? 1 : -1;
    } else {
      const byCategory = collator.compare(toMatchKey(a.category), toMatchKey(b.category));
      if (byCategory !== 0) return byCategory;
    }
    return collator.compare(toMatchKey(a.name), toMatchKey(b.name));
  });
}

function categoryValue(category: string | null): string {
  return category === null ? NO_CATEGORY : `category:${toMatchKey(category)}`;
}

// One option per category the store uses (spelt as its first service in sort
// order has it), plus "No category" when some services have none.
export function categoryOptions(services: readonly CatalogueService[]): CategoryOption[] {
  const options = new Map<string, CategoryOption>();
  let uncategorised = false;
  for (const { category } of sortServices(services)) {
    if (category === null) uncategorised = true;
    else if (!options.has(categoryValue(category))) {
      options.set(categoryValue(category), { value: categoryValue(category), label: category });
    }
  }
  return [
    { value: ALL_CATEGORIES, label: "All categories" },
    ...options.values(),
    ...(uncategorised ? [{ value: NO_CATEGORY, label: "No category" }] : []),
  ];
}

// The store's categories, for suggestions as the owner types one.
export function categorySuggestions(services: readonly CatalogueService[]): string[] {
  return categoryOptions(services)
    .filter((option) => option.value.startsWith("category:"))
    .map((option) => option.label);
}

export function filterServices(
  services: readonly CatalogueService[],
  { query, category }: { query: string; category: string },
): CatalogueService[] {
  const search = toMatchKey(query);
  return services.filter(
    (service) =>
      (category === ALL_CATEGORIES || categoryValue(service.category) === category) &&
      (!search || toMatchKey(service.name).includes(search)),
  );
}

// Services the page saved itself (the copy each action returned), by ID. They
// show at once, without waiting for the page's refreshed data.
export type SavedServices = ReadonlyMap<string, CatalogueService>;

const isNewer = (a: CatalogueService, b: CatalogueService) => a.updatedAt.getTime() > b.updatedAt.getTime();

// The newest copy of every service: a saved copy replaces the server's until
// the server's is as new (so an older refresh, say the one from Disable
// arriving after Undo, can't bring back a stale state), and services just
// added appear before the server lists them.
export function withSavedServices(services: readonly CatalogueService[], saved: SavedServices): CatalogueService[] {
  const merged = services.map((service) => {
    const copy = saved.get(service.id);
    return copy && isNewer(copy, service) ? copy : service;
  });
  const listed = new Set(services.map((service) => service.id));
  for (const copy of saved.values()) if (!listed.has(copy.id)) merged.push(copy);
  return merged;
}

// Adds a saved copy (unless a newer one is already saved), dropping copies the
// server has caught up with.
export function rememberSavedService(
  saved: SavedServices,
  service: CatalogueService,
  services: readonly CatalogueService[],
): SavedServices {
  const byId = new Map(services.map((listed) => [listed.id, listed]));
  const next = new Map<string, CatalogueService>();
  for (const copy of [...saved.values(), service]) {
    const listed = byId.get(copy.id);
    const kept = next.get(copy.id);
    if ((!listed || isNewer(copy, listed)) && (!kept || isNewer(copy, kept))) next.set(copy.id, copy);
  }
  return next;
}
