// Run with `npm run db:seed` (prisma db seed); Prisma 7 never seeds on its own.
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

import { PrismaClient } from "@/generated/prisma/client";
import { pgPoolConfig } from "@/lib/database-url";
import { getServerEnv } from "@/lib/env";

import { assertSeedAllowed, seedUserPassword } from "./seed/guard";
import { runSeed } from "./seed/run";

async function main(): Promise<void> {
  // Variables already in the environment (CI, the integration-test setup) win.
  config({ path: ".env.local", quiet: true });
  const env = getServerEnv();
  assertSeedAllowed(env);
  // Read here, not in env.ts: only the seed needs it, and never in production.
  const password = seedUserPassword(process.env);

  const prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(env.DATABASE_URL)) });
  try {
    const stores = await runSeed(prisma, password);
    for (const store of stores) {
      process.stdout.write(
        `Seeded ${store.name}: ${store.orderNumbers.length} orders (${store.orderNumbers[0]}–${store.orderNumbers.at(-1)})\n`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
