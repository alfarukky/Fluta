import { isNodeServerStartup } from "@/lib/env";

// Runs once when a Next.js server starts (dev and production). Node-only code
// is imported dynamically so process.exit never reaches an Edge bundle.
export async function register() {
  if (!isNodeServerStartup()) return;
  const { validateEnvOrExit } = await import("./instrumentation-node");
  validateEnvOrExit();
}
