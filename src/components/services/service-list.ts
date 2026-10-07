import { toMatchKey } from "@/lib/match-key";
import { rememberSavedRecord, withSavedRecords, type SavedRecords } from "@/components/shared/saved-records";
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

// Services the page saved itself (the copy each action returned), by ID; the
// newest copy wins (src/components/shared/saved-records.ts).
export type SavedServices = SavedRecords<CatalogueService>;

export function withSavedServices(services: readonly CatalogueService[], saved: SavedServices): CatalogueService[] {
  return withSavedRecords(services, saved);
}

export function rememberSavedService(
  saved: SavedServices,
  service: CatalogueService,
  services: readonly CatalogueService[],
): SavedServices {
  return rememberSavedRecord(saved, service, services);
}
