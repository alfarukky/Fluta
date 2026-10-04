import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { pgPoolConfig } from "@/lib/database-url";
import { getServerEnv, isDevelopment } from "@/lib/env";

// The pooled URL with the TCP (pg) adapter. Neon's HTTP-only adapter can't run
// interactive transactions, which order creation and stage changes rely on.
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg(pgPoolConfig(getServerEnv().DATABASE_URL));
  return new PrismaClient({ adapter });
}

// Hot reloads re-evaluate this module; reuse one client so each reload doesn't
// open a new connection pool.
const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (isDevelopment()) {
  globalForPrisma.prisma = prisma;
}
