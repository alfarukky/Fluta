import { describe, expect, it } from "vitest";

import { normalizeEmail } from "./email-address";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  John@Example.COM ")).toBe("john@example.com");
  });

  it("leaves a normalized address unchanged", () => {
    expect(normalizeEmail("ada@freshfold.example")).toBe("ada@freshfold.example");
  });
});
