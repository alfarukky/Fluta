import type { PrismaClient } from "@/generated/prisma/client";

import { assertActorIdsExist } from "./actor-check";
import { cleanWaveSpec, CLEANWAVE_SLUG } from "./cleanwave";
import { clearSeedData } from "./clear";
import { freshFoldSpec, FRESHFOLD_SLUG } from "./freshfold";
import { seedStore, type SeedStoreResult } from "./store-builder";
import { SEED_USER_EMAILS, seedUsers } from "./users";

// Users first, so memberships and every actor ID use their real generated IDs.
export async function runSeed(prisma: PrismaClient, password: string, now = new Date()): Promise<SeedStoreResult[]> {
  await clearSeedData(prisma, [FRESHFOLD_SLUG, CLEANWAVE_SLUG], SEED_USER_EMAILS);
  const users = await seedUsers(prisma, password);
  const freshFold = await seedStore(prisma, now, freshFoldSpec(now), {
    ownerUserId: users.freshFoldOwner,
    staffUserIds: [users.freshFoldStaff],
  });
  const cleanWave = await seedStore(prisma, now, cleanWaveSpec(), {
    ownerUserId: users.cleanWaveOwner,
    staffUserIds: [],
  });
  await assertActorIdsExist(prisma, [freshFold.storeId, cleanWave.storeId]);
  return [freshFold, cleanWave];
}
