import "server-only";

import { generateRandomString, hashPassword } from "better-auth/crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { newUserSchema, type NewUserInput } from "@/schemas/users";

// Better Auth's provider ID for email-and-password accounts.
const CREDENTIAL_PROVIDER_ID = "credential";

// The only way a Fluta user is created: every Better Auth sign-up path is
// disabled (src/server/auth/auth.ts). Writes the User and its credential
// Account together, with the password hashed by Better Auth's own hasher so
// sign-in can verify it. Takes the client explicitly because the seed runs
// outside Next.js with its own client.
export async function createUserWithPassword(input: NewUserInput, db: PrismaClient): Promise<{ id: string }> {
  const { name, email, password, platformRole } = newUserSchema.parse(input);
  const passwordHash = await hashPassword(password);

  return db.$transaction(async (tx) => {
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
  });
}
