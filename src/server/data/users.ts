import "server-only";

import { generateRandomString, hashPassword } from "better-auth/crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { newUserSchema, type NewUserInput } from "@/schemas/users";

// Neon round trips are slow from here; the default 5s can expire mid-write.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

// Better Auth's provider ID for email-and-password accounts.
const CREDENTIAL_PROVIDER_ID = "credential";

// A validated user (email normalized) with the password already hashed, so the
// slow hash runs before any transaction opens.
export interface PreparedUser {
  name: string;
  email: string;
  passwordHash: string;
  platformRole: "USER" | "FLUTA_ADMIN";
}

export async function prepareUserWithPassword(input: NewUserInput): Promise<PreparedUser> {
  const { name, email, password, platformRole } = newUserSchema.parse(input);
  return { name, email, platformRole, passwordHash: await hashPassword(password) };
}

// The only way a Fluta user is created: every Better Auth sign-up path is
// disabled (src/server/auth/auth.ts). Writes the User and its credential
// Account together, with the password hashed by Better Auth's own hasher so
// sign-in can verify it. Takes the client explicitly because the seed runs
// outside Next.js with its own client.
export async function createUserWithPassword(input: NewUserInput, db: PrismaClient): Promise<{ id: string }> {
  const user = await prepareUserWithPassword(input);
  return db.$transaction((tx) => insertUserWithPassword(user, tx), TRANSACTION_OPTIONS);
}

// The same, inside the caller's transaction (invitation acceptance).
export async function insertUserWithPassword(
  { name, email, platformRole, passwordHash }: PreparedUser,
  tx: Prisma.TransactionClient,
): Promise<{ id: string }> {
  const user = await tx.user.create({
    data: { id: generateRandomString(32), name, email, platformRole },
    select: { id: true },
  });
  await tx.account.create({
    data: {
      id: generateRandomString(32),
      // Better Auth looks credential accounts up by accountId = userId.
      accountId: user.id,
      providerId: CREDENTIAL_PROVIDER_ID,
      userId: user.id,
      password: passwordHash,
    },
  });
  return user;
}
