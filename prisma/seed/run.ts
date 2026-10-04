import type { PrismaClient } from "@/generated/prisma/client";

import { cleanWaveSpec, CLEANWAVE_SLUG } from "./cleanwave";
import { clearSeedStores } from "./clear";
import { freshFoldSpec, FRESHFOLD_SLUG } from "./freshfold";
import { seedStore, type SeedStoreResult } from "./store-builder";

export async function runSeed(prisma: PrismaClient, now = new Date()): Promise<SeedStoreResult[]> {
  await clearSeedStores(prisma, [FRESHFOLD_SLUG, CLEANWAVE_SLUG]);
  const freshFold = await seedStore(prisma, now, freshFoldSpec(now));
  const cleanWave = await seedStore(prisma, now, cleanWaveSpec());
  return [freshFold, cleanWave];
}
