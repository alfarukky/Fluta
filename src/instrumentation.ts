import { isNodeServerStartup } from "@/lib/env";

// Runs once when a Next.js server starts (dev and production). Node-only code
// is imported dynamically so process.exit never reaches an Edge bundle.
export async function register() {
  // Read inline, not only through env.ts: Next replaces NEXT_RUNTIME at build
  // time, and only an inline check lets the bundler drop the Node-only import
  // from the Edge bundle (otherwise every build warns about process.exit).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!isNodeServerStartup()) return;
  const { validateEnvOrExit } = await import("./instrumentation-node");
  validateEnvOrExit();
}
