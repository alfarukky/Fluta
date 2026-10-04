import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

import { loadTestEnv } from "./src/test/integration/test-env";

const INTEGRATION_TESTS = ["{src,prisma}/**/*.integration.test.ts"];

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}", "prisma/**/*.test.ts"],
          exclude: INTEGRATION_TESTS,
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          // Real PostgreSQL: the Neon `test` branch from .env.test, never
          // development or production (global-setup.ts checks).
          name: "integration",
          environment: "node",
          include: INTEGRATION_TESTS,
          env: loadTestEnv(),
          globalSetup: ["./src/test/integration/global-setup.ts"],
          // Files share one database; run them one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
