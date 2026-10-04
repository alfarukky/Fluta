import { describe, expect, it } from "vitest";

import { assertSeedAllowed, seedUserPassword } from "./guard";

describe("assertSeedAllowed", () => {
  it("refuses the production branch", () => {
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "production" })).toThrow(/Refusing to seed/);
  });

  it("allows development and test", () => {
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "development" })).not.toThrow();
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "test" })).not.toThrow();
  });
});

describe("seedUserPassword", () => {
  it("returns the password when it's set", () => {
    expect(seedUserPassword({ SEED_USER_PASSWORD: "long-enough-password" })).toBe("long-enough-password");
  });

  it("stops with a clear message when it's missing or empty", () => {
    for (const value of [undefined, ""]) {
      expect(() => seedUserPassword({ SEED_USER_PASSWORD: value })).toThrow(/SEED_USER_PASSWORD is missing/);
    }
  });

  it("refuses a password sign-in would reject", () => {
    expect(() => seedUserPassword({ SEED_USER_PASSWORD: "short" })).toThrow(/at least 8 characters/);
  });
});
