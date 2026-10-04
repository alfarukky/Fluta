import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 loads no env files itself, and dotenv reads `.env` by default.
// Variables already set in the environment win, so CI and the integration-test
// setup can point the CLI at another branch.
config({ path: ".env.local", quiet: true });

// The CLI needs a direct (non-pooled) connection for migrations. Read it
// without prisma/config's env(), which throws when unset: `prisma generate`
// (run by postinstall on fresh clones, CI and Railway) needs no database.
const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // react-server: the seed creates users through src/server/data, whose
    // modules import `server-only` (empty under this condition).
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
