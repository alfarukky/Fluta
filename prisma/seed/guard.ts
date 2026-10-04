import type { ServerEnv } from "@/lib/env";

export function assertSeedAllowed(env: Pick<ServerEnv, "DATABASE_BRANCH">): void {
  if (env.DATABASE_BRANCH === "production") {
    throw new Error(
      "Refusing to seed: DATABASE_BRANCH is \"production\". The seed deletes and " +
        "recreates sample stores and must only run on development or test.",
    );
  }
}
