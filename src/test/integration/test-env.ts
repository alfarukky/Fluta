import { existsSync, readFileSync } from "node:fs";

import { parse } from "dotenv";

export const TEST_ENV_FILE = ".env.test";

// The variables from .env.test, or {} if it's missing (global-setup.ts then
// fails with a clear message). Loaded from the file only, never .env.local.
export function loadTestEnv(): Record<string, string> {
  return existsSync(TEST_ENV_FILE) ? parse(readFileSync(TEST_ENV_FILE)) : {};
}

// Throws unless `env` is explicitly the Neon test branch, and (when .env.local
// exists) unless it points at a different host from development.
export function assertTestDatabase(
  env: Record<string, string | undefined>,
  developmentEnv: Record<string, string | undefined> = {},
): void {
  if (env.DATABASE_BRANCH !== "test") {
    throw new Error(
      `Integration tests need ${TEST_ENV_FILE} with DATABASE_BRANCH="test" ` +
        `(got ${JSON.stringify(env.DATABASE_BRANCH)}). They never run against development or production.`,
    );
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    const testUrl = env[key];
    if (!testUrl) throw new Error(`${TEST_ENV_FILE} is missing ${key}.`);
    const developmentUrl = developmentEnv[key];
    if (developmentUrl && new URL(developmentUrl).host === new URL(testUrl).host) {
      throw new Error(`${TEST_ENV_FILE} ${key} points at the development database host.`);
    }
  }
}
