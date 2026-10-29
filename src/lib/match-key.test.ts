import { describe, expect, it } from "vitest";

import { toMatchKey } from "./match-key";

describe("toMatchKey", () => {
  it("ignores case and extra spaces", () => {
    expect(toMatchKey("  Wash   &  Iron ")).toBe("wash & iron");
    expect(toMatchKey("WASH & IRON")).toBe(toMatchKey("wash & iron"));
  });

  it("treats tabs and newlines as spaces", () => {
    expect(toMatchKey("Wash\tand\n iron")).toBe("wash and iron");
  });

  it("returns an empty key for whitespace", () => {
    expect(toMatchKey("   ")).toBe("");
  });
});
