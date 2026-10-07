import { describe, expect, it } from "vitest";

import { toMatchKey } from "./match-key";

describe("toMatchKey", () => {
  it("ignores case and extra spaces", () => {
    expect(toMatchKey("  Wash   &  Iron ")).toBe("wash & iron");
    expect(toMatchKey("WASH & IRON")).toBe(toMatchKey("wash & iron"));
  });

  it("treats tabs and newlines as spaces", () => {
    expect(toMatchKey("Laundry\tby\n weight")).toBe("laundry by weight");
  });

  it("returns an empty key for whitespace", () => {
    expect(toMatchKey("   ")).toBe("");
  });
});
