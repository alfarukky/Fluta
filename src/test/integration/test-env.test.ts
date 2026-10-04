import { describe, expect, it } from "vitest";

import { assertTestDatabase } from "./test-env";

const TEST = {
  DATABASE_BRANCH: "test",
  DATABASE_URL: "postgresql://u:p@ep-test-pooler.example.neon.tech/neondb",
  DIRECT_URL: "postgresql://u:p@ep-test.example.neon.tech/neondb",
};
const DEVELOPMENT = {
  DATABASE_URL: "postgresql://u:p@ep-dev-pooler.example.neon.tech/neondb",
  DIRECT_URL: "postgresql://u:p@ep-dev.example.neon.tech/neondb",
};

describe("assertTestDatabase", () => {
  it("accepts the test branch on its own host", () => {
    expect(() => assertTestDatabase(TEST, DEVELOPMENT)).not.toThrow();
  });

  it("refuses any branch other than test", () => {
    for (const branch of ["development", "production", undefined]) {
      expect(() => assertTestDatabase({ ...TEST, DATABASE_BRANCH: branch })).toThrow(/DATABASE_BRANCH="test"/);
    }
  });

  it("refuses a test file that points at the development host", () => {
    expect(() => assertTestDatabase({ ...TEST, DIRECT_URL: DEVELOPMENT.DIRECT_URL }, DEVELOPMENT)).toThrow(
      /DIRECT_URL points at the development database host/,
    );
  });

  it("refuses a missing URL", () => {
    expect(() => assertTestDatabase({ ...TEST, DATABASE_URL: undefined })).toThrow(/missing DATABASE_URL/);
  });
});
