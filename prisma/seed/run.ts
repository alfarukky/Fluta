import type { PrismaClient } from "@/generated/prisma/client";

import { assertActorIdsExist } from "./actor-check";
import { cleanWaveSpec, CLEANWAVE_SLUG } from "./cleanwave";
import { clearSeedData } from "./clear";
import { freshFoldSpec, FRESHFOLD_SLUG } from "./freshfold";
import type { SeedMode } from "./guard";
import { seedStore, type SeedStoreResult, type SeedStoreSpec } from "./store-builder";
import { SEED_USER_EMAILS, seedUsers } from "./users";

// Users first, so memberships and every actor ID use their real generated IDs.
//
// minimal (development and staging): the two stores, each owner, and an
// active subscription each. Services, areas, customers, orders, staff, and
// riders are created through the app. The Fluta admin is seeded too, so
// /admin can be signed in to.
// full (the integration tests' test branch): the sample data, with staff, a
// rider, services, and orders in every stage.
export async function runSeed(
  prisma: PrismaClient,
  password: string,
  mode: SeedMode,
  now = new Date(),
): Promise<SeedStoreResult[]> {
  // Every seeded user's email, so a minimal run also removes the full seed's staff and rider.
  await clearSeedData(prisma, [FRESHFOLD_SLUG, CLEANWAVE_SLUG], SEED_USER_EMAILS);
  const users = await seedUsers(prisma, password, mode === "full" ? undefined : ["freshFoldOwner", "cleanWaveOwner", "flutaAdmin"]);
  const full = mode === "full";
  const freshFold = await seedStore(prisma, now, full ? freshFoldSpec(now) : minimalSpec(freshFoldSpec(now)), {
    ownerUserId: users.freshFoldOwner,
    staffUserIds: full ? [users.freshFoldStaff] : [],
    riderUserIds: full ? [users.freshFoldRider] : [],
  });
  const cleanWave = await seedStore(prisma, now, full ? cleanWaveSpec() : minimalSpec(cleanWaveSpec()), {
    ownerUserId: users.cleanWaveOwner,
    staffUserIds: [],
  });
  await assertActorIdsExist(prisma, [freshFold.storeId, cleanWave.storeId]);
  return [freshFold, cleanWave];
}

// The store itself and an active subscription (current period started 2 days
// ago, so its invoice isn't overdue), and nothing else.
function minimalSpec(spec: SeedStoreSpec): SeedStoreSpec {
  return {
    store: spec.store,
    areas: [],
    services: [],
    customers: [],
    closedDates: [],
    subscription: { ...spec.subscription, periodStartedDaysAgo: 2 },
    orders: [],
  };
}
