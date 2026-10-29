import type { PrismaClient } from "@/generated/prisma/client";
import type { NewUserInput } from "@/schemas/users";
import { createUserWithPassword } from "@/server/data/users";

// Fictional people on reserved example domains. All sign in with SEED_USER_PASSWORD.
export const SEED_USERS = {
  freshFoldOwner: { name: "Ada Okafor", email: "ada@freshfold.example" },
  freshFoldStaff: { name: "Kemi Adeyemi", email: "kemi@freshfold.example" },
  freshFoldRider: { name: "Tayo Balogun", email: "tayo@freshfold.example" },
  cleanWaveOwner: { name: "Musa Bello", email: "musa@cleanwave.example" },
  // A Fluta admin has no store membership.
  flutaAdmin: { name: "Fluta Admin", email: "admin@fluta.example", platformRole: "FLUTA_ADMIN" },
} satisfies Record<string, Omit<NewUserInput, "password">>;

export type SeedUserKey = keyof typeof SEED_USERS;

export const SEED_USER_EMAILS = Object.values(SEED_USERS).map((user) => user.email);

// Through the app's one user-creation function, so seeded users are exactly
// what invitation acceptance will create.
// Only the users named in `only`, when given; the others' IDs are missing.
export async function seedUsers(
  prisma: PrismaClient,
  password: string,
  only?: readonly SeedUserKey[],
): Promise<Record<SeedUserKey, string>> {
  const ids: Partial<Record<SeedUserKey, string>> = {};
  for (const [key, user] of Object.entries(SEED_USERS) as [SeedUserKey, (typeof SEED_USERS)[SeedUserKey]][]) {
    if (only && !only.includes(key)) continue;
    ids[key] = (await createUserWithPassword({ ...user, password }, prisma)).id;
  }
  return ids as Record<SeedUserKey, string>;
}
