import "server-only";

import { Prisma } from "@/generated/prisma/client";

// A unique rule refused the write (Prisma P2002). Services use this to turn a
// duplicate into a result without importing Prisma themselves.
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
