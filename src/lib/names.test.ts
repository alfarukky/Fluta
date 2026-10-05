import { describe, expect, it } from "vitest";

import { getFirstName, getInitials } from "./names";

describe("getFirstName", () => {
  it("returns the first word of the name", () => {
    expect(getFirstName("Aisha Ibrahim")).toBe("Aisha");
    expect(getFirstName("  Kemi   Adeyemi ")).toBe("Kemi");
    expect(getFirstName("Musa")).toBe("Musa");
  });
});

describe("getInitials", () => {
  it("uses the first and last words", () => {
    expect(getInitials("Aisha Ibrahim")).toBe("AI");
    expect(getInitials("aisha bello ibrahim")).toBe("AI");
  });

  it("handles one word and blank names", () => {
    expect(getInitials("Musa")).toBe("M");
    expect(getInitials("   ")).toBe("");
  });
});
