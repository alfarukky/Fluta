import { describe, expect, it } from "vitest";

import { assertSeedAllowed, getSeedMode, seedUserPassword } from "./guard";

describe("assertSeedAllowed", () => {
  it("refuses the production branch", () => {
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "production" })).toThrow(/Refusing to seed/);
  });

  it("allows development and test", () => {
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "development" })).not.toThrow();
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "test" })).not.toThrow();
  });

  it("refuses the production branch even with ALLOW_STAGING_SEED", () => {
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "production", ALLOW_STAGING_SEED: "true" })).toThrow(/never run on production/);
  });

  it.each([undefined, "", "false", "1", "TRUE"])("refuses staging when ALLOW_STAGING_SEED is %j", (value) => {
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "staging", ALLOW_STAGING_SEED: value })).toThrow(/ALLOW_STAGING_SEED/);
  });

  it("allows staging only with ALLOW_STAGING_SEED=true", () => {
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "staging", ALLOW_STAGING_SEED: "true" })).not.toThrow();
  });
});

describe("getSeedMode", () => {
  it("loads the minimal seed by default, on any branch the seed allows", () => {
    expect(getSeedMode([], { DATABASE_BRANCH: "development" })).toBe("minimal");
    expect(getSeedMode([], { DATABASE_BRANCH: "staging" })).toBe("minimal");
    expect(getSeedMode([], { DATABASE_BRANCH: "test" })).toBe("minimal");
  });

  it("loads the full sample data only on the test branch", () => {
    expect(getSeedMode(["--full"], { DATABASE_BRANCH: "test" })).toBe("full");
    for (const DATABASE_BRANCH of ["development", "staging", "production"] as const) {
      expect(() => getSeedMode(["--full"], { DATABASE_BRANCH })).toThrow(/integration tests on the test branch only/);
    }
  });

  it("refuses an unknown option rather than guessing", () => {
    expect(() => getSeedMode(["--ful"], { DATABASE_BRANCH: "test" })).toThrow(/Unknown seed option/);
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
