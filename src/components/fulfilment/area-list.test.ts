import { describe, expect, it } from "vitest";

import type { FulfilmentArea } from "@/types/fulfilment";

import { sortAreas } from "./area-list";

const area = (name: string, isActive = true): FulfilmentArea => ({
  id: name,
  name,
  chargeType: "FIXED",
  fixedCharge: 0,
  isActive,
  updatedAt: new Date(0),
});

describe("sortAreas", () => {
  it("sorts by name ignoring case, with numbers in order, disabled areas included", () => {
    const sorted = sortAreas([area("wuse 2"), area("Wuse 11"), area("Karu", false), area("Garki")]);
    expect(sorted.map((a) => a.name)).toEqual(["Garki", "Karu", "wuse 2", "Wuse 11"]);
  });
});
