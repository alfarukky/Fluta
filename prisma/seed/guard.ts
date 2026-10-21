import { z } from "zod";

import type { ServerEnv } from "@/lib/env";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/schemas/users";

// The seed deletes and recreates the sample stores: never on production, and
// on staging only when ALLOW_STAGING_SEED is "true" (set for one deliberate
// run, then removed).
export function assertSeedAllowed(env: Pick<ServerEnv, "DATABASE_BRANCH"> & { ALLOW_STAGING_SEED?: string }): void {
  if (env.DATABASE_BRANCH === "production") {
    throw new Error(
      "Refusing to seed: DATABASE_BRANCH is \"production\". The seed deletes and " +
        "recreates sample stores and must never run on production.",
    );
  }
  if (env.DATABASE_BRANCH === "staging" && env.ALLOW_STAGING_SEED !== "true") {
    throw new Error(
      "Refusing to seed: DATABASE_BRANCH is \"staging\". Set ALLOW_STAGING_SEED=\"true\" for this one run " +
        "to replace the staging demo stores.",
    );
  }
}

const seedPasswordSchema = z
  .string({ error: "is missing" })
  .min(MIN_PASSWORD_LENGTH, `must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `must be at most ${MAX_PASSWORD_LENGTH} characters`);

// The one password every seeded user signs in with. Read by the seed only (the
// app's env.ts never sees it) and never set in production.
export function seedUserPassword(env: Record<string, string | undefined>): string {
  const result = seedPasswordSchema.safeParse(env.SEED_USER_PASSWORD || undefined);
  if (!result.success) {
    throw new Error(
      `SEED_USER_PASSWORD ${result.error.issues[0].message}. Set it in .env.local (and .env.test); ` +
        "every seeded user signs in with it.",
    );
  }
  return result.data;
}
