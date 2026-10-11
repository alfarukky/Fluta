import "server-only";

import { prismaAdapter } from "better-auth/adapters/prisma";

import { getPrisma } from "./client";

// Better Auth's tables (User, Session, Account, Verification, RateLimit) read
// and written through the shared Prisma client, so auth.ts never touches Prisma.
export function getAuthDatabase() {
  return prismaAdapter(getPrisma(), { provider: "postgresql" });
}
