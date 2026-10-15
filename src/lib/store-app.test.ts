import { describe, expect, it } from "vitest";

import { getAppShortName } from "./store-app";

describe("getAppShortName", () => {
  it("keeps a name of 12 characters or fewer", () => {
    expect(getAppShortName("CleanWave")).toBe("CleanWave");
    expect(getAppShortName("Twelve Chars")).toBe("Twelve Chars");
  });

  it("keeps as many whole words as fit", () => {
    expect(getAppShortName("FreshFold Laundry")).toBe("FreshFold");
    expect(getAppShortName("Mama Ada Laundry Services")).toBe("Mama Ada");
    expect(getAppShortName("Wash & Fold Express")).toBe("Wash & Fold");
  });

  it("drops a trailing joiner", () => {
    expect(getAppShortName("Wash & Laundromat")).toBe("Wash");
  });

  it("cuts a long first word to fit", () => {
    expect(getAppShortName("Supercalifragilistic Laundry")).toBe("Supercalifra");
  });
});
