import { getServerEnv } from "@/lib/env";

// Fail fast: a server that keeps running with broken configuration only fails
// later, on the first database call, with a far less helpful error.
export function validateEnvOrExit(): void {
  try {
    getServerEnv();
  } catch (error) {
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n\n`);
    process.exit(1);
  }
}
