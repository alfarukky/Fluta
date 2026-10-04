import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getServerEnv() caches its result, so each test loads fresh modules.
async function loadValidateEnvOrExit() {
  vi.resetModules();
  return (await import("./instrumentation-node")).validateEnvOrExit;
}

describe("validateEnvOrExit", () => {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prints the problem and exits with status 1 when a variable is missing", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("DATABASE_BRANCH", "development");
    const validateEnvOrExit = await loadValidateEnvOrExit();

    validateEnvOrExit();

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("does nothing when the environment is valid", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@ep-x-pooler.example.neon.tech/neondb");
    vi.stubEnv("DATABASE_BRANCH", "development");
    const validateEnvOrExit = await loadValidateEnvOrExit();

    validateEnvOrExit();

    expect(process.exit).not.toHaveBeenCalled();
  });
});
