import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { pgPoolConfig } from "@/lib/database-url";
import { parseServerEnv } from "@/lib/env";

import { assertTestDatabase } from "./test-env";

// A Prisma client for integration tests, on the test branch only. (The app's
// client in src/server/data/client.ts is `server-only` and can't load here.)
export function createTestPrisma(): PrismaClient {
  assertTestDatabase(process.env);
  const { DATABASE_URL } = parseServerEnv(process.env);
  return new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(DATABASE_URL)) });
}
