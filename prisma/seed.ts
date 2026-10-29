// Run with `npm run db:seed` (prisma db seed); Prisma 7 never seeds on its own.
// The minimal seed by default; `prisma db seed -- --full` loads the full
// sample data, on the test branch only (the integration tests' setup).
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

import { PrismaClient } from "@/generated/prisma/client";
import { pgPoolConfig } from "@/lib/database-url";
import { getServerEnv } from "@/lib/env";

import { assertSeedAllowed, getSeedMode, seedUserPassword } from "./seed/guard";
import { runSeed } from "./seed/run";

async function main(): Promise<void> {
  // Variables already in the environment (CI, the integration-test setup) win.
  config({ path: ".env.local", quiet: true });
  const env = getServerEnv();
  // ALLOW_STAGING_SEED is read here, like the password: only the seed needs it.
  assertSeedAllowed({ DATABASE_BRANCH: env.DATABASE_BRANCH, ALLOW_STAGING_SEED: process.env.ALLOW_STAGING_SEED });
  // Read here, not in env.ts: only the seed needs it, and never in production.
  const password = seedUserPassword(process.env);
  const mode = getSeedMode(process.argv.slice(2), env);

  const prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(env.DATABASE_URL)) });
  try {
    const stores = await runSeed(prisma, password, mode);
    for (const store of stores) {
      const orders = store.orderNumbers.length
        ? `${store.orderNumbers.length} orders (${store.orderNumbers[0]}–${store.orderNumbers.at(-1)})`
        : "owner and subscription only";
      process.stdout.write(`Seeded ${store.name} (${mode}): ${orders}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
