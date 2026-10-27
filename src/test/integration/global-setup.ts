import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { parse } from "dotenv";

import { assertTestDatabase, loadTestEnv } from "./test-env";

// Before the integration suite: bring the Neon `test` branch up to date with
// every migration, then reset the sample data by running the real seed with
// --full (which clears and recreates both stores with services, staff, and
// orders). Development and staging get the minimal seed instead.
export default function setup(): void {
  const testEnv = loadTestEnv();
  const developmentEnv = existsSync(".env.local") ? parse(readFileSync(".env.local")) : {};
  assertTestDatabase(testEnv, developmentEnv);

  // The test values override anything inherited, so the CLI and the seed
  // (which only fill in unset variables from .env.local) both see the test branch.
  const env = { ...process.env, ...testEnv };
  for (const args of [["migrate", "deploy"], ["db", "seed", "--", "--full"]]) {
    execFileSync("npx", ["prisma", ...args], { env, stdio: "inherit" });
  }
}
