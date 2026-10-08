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
    vi.stubEnv("BETTER_AUTH_SECRET", "a-test-secret-that-is-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("R2_ACCOUNT_ID", "account");
    vi.stubEnv("R2_ACCESS_KEY_ID", "access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("R2_BUCKET", "fluta-test");
    vi.stubEnv("R2_PUBLIC_URL", "https://logos.example.com");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_PORT", "465");
    vi.stubEnv("SMTP_USER", "mailer@example.com");
    vi.stubEnv("SMTP_PASS", "app-password");
    vi.stubEnv("EMAIL_FROM", "Fluta <mailer@example.com>");
    const validateEnvOrExit = await loadValidateEnvOrExit();

    validateEnvOrExit();

    expect(process.exit).not.toHaveBeenCalled();
  });
});
