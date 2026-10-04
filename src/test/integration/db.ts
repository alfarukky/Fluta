import { PrismaPg } from "@prisma/adapter-pg";

import { expect } from "vitest";

import { PrismaClient, type Prisma } from "@/generated/prisma/client";
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

class Rollback extends Error {}

// Runs `write` in a transaction that is always rolled back, so accepted inserts
// leave nothing behind for other tests.
export async function insertThenRollBack(
  prisma: PrismaClient,
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await write(tx);
        throw new Rollback();
      },
      { maxWait: 15_000, timeout: 20_000 },
    );
  } catch (error) {
    // Anything but our own rollback (a constraint error, say) fails the test as-is.
    if (!(error instanceof Rollback)) throw error;
    return;
  }
  expect.unreachable("the transaction should have been rolled back");
}
