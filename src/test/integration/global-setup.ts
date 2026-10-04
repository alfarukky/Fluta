import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { parse } from "dotenv";

import { assertTestDatabase, loadTestEnv } from "./test-env";

// Before the integration suite: bring the Neon `test` branch up to date with
// every migration, then reset the sample data by running the real seed (which
// clears and recreates both stores).
export default function setup(): void {
  const testEnv = loadTestEnv();
  const developmentEnv = existsSync(".env.local") ? parse(readFileSync(".env.local")) : {};
  assertTestDatabase(testEnv, developmentEnv);

  // The test values override anything inherited, so the CLI and the seed
  // (which only fill in unset variables from .env.local) both see the test branch.
  const env = { ...process.env, ...testEnv };
  for (const args of [["migrate", "deploy"], ["db", "seed"]]) {
    execFileSync("npx", ["prisma", ...args], { env, stdio: "inherit" });
  }
}
