import { getDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

import { describe, expect, it } from "vitest";

import { pgPoolConfig } from "./database-url";

const URL_BASE = "postgresql://user:pw@ep-x-pooler.example.neon.tech/neondb?sslmode=verify-full";

describe("pgPoolConfig", () => {
  it("turns connect_timeout (seconds) into pg's connectionTimeoutMillis", () => {
    const url = `${URL_BASE}&connect_timeout=15`;
    expect(pgPoolConfig(url)).toEqual({ connectionString: url, connectionTimeoutMillis: 15_000 });
  });

  it("leaves pg's default when the URL has no connect_timeout", () => {
    expect(pgPoolConfig(URL_BASE).connectionTimeoutMillis).toBeUndefined();
  });

  it("gives each resolved address at least 2 seconds to connect", () => {
    pgPoolConfig(URL_BASE);
    expect(getDefaultAutoSelectFamilyAttemptTimeout()).toBeGreaterThanOrEqual(2_000);
  });
});
