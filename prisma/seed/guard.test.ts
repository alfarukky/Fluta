import { describe, expect, it } from "vitest";

import { assertSeedAllowed } from "./guard";

describe("assertSeedAllowed", () => {
  it("refuses the production branch", () => {
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "production" })).toThrow(/Refusing to seed/);
  });

  it("allows development and test", () => {
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "development" })).not.toThrow();
    expect(() => assertSeedAllowed({ DATABASE_BRANCH: "test" })).not.toThrow();
  });
});
