import { toMatchKey } from "@/lib/match-key";
import type { FulfilmentArea } from "@/types/fulfilment";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

// By name, ignoring case and extra spaces; disabled areas stay in place.
export function sortAreas(areas: readonly FulfilmentArea[]): FulfilmentArea[] {
  return [...areas].sort((a, b) => collator.compare(toMatchKey(a.name), toMatchKey(b.name)));
}
