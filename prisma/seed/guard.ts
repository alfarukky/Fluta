import { z } from "zod";

import type { ServerEnv } from "@/lib/env";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/schemas/users";

export function assertSeedAllowed(env: Pick<ServerEnv, "DATABASE_BRANCH">): void {
  if (env.DATABASE_BRANCH === "production") {
    throw new Error(
      "Refusing to seed: DATABASE_BRANCH is \"production\". The seed deletes and " +
        "recreates sample stores and must only run on development or test.",
    );
  }
}

const seedPasswordSchema = z
  .string({ error: "is missing" })
  .min(PASSWORD_MIN_LENGTH, `must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `must be at most ${PASSWORD_MAX_LENGTH} characters`);

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
