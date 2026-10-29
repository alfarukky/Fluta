import { afterEach, describe, expect, it, vi } from "vitest";

import { isNodeServerStartup, isStaging, parseServerEnv } from "./env";

const VALID = {
  DATABASE_URL: "postgresql://user:secret@ep-x-pooler.example.neon.tech/neondb?sslmode=verify-full",
  DATABASE_BRANCH: "development",
  BETTER_AUTH_SECRET: "a-test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_BUCKET: "fluta-test",
  R2_PUBLIC_URL: "https://logos.example.com",
  RESEND_API_KEY: "re_test_placeholder",
  EMAIL_FROM: "Fluta <mailer@example.com>",
  BOOKING_IP_SECRET: "a-booking-ip-secret-of-at-least-32-characters",
  CRON_SECRET: "a-cron-secret-that-is-at-least-32-characters",
  FLUTA_ALERT_EMAIL: "alerts@example.com",
};

const TERMII = {
  TERMII_API_KEY: "termii-test-key",
  TERMII_SENDER_ID: "Fluta",
  TERMII_BASE_URL: "https://api.example.termii.com",
};

describe("parseServerEnv", () => {
  it("requires a booking IP secret of at least 32 characters", () => {
    expect(() => parseServerEnv({ ...VALID, BOOKING_IP_SECRET: "too-short" })).toThrow(
      /BOOKING_IP_SECRET: must be at least 32 characters/,
    );
  });


  it("requires the Resend API key and the sender", () => {
    expect(() => parseServerEnv({ ...VALID, RESEND_API_KEY: "", EMAIL_FROM: "" })).toThrow(
      /RESEND_API_KEY: is required[\s\S]*EMAIL_FROM: is required/,
    );
  });

  it("requires a cron secret of at least 32 characters and the alert email", () => {
    expect(() => parseServerEnv({ ...VALID, CRON_SECRET: "short", FLUTA_ALERT_EMAIL: "" })).toThrow(
      /CRON_SECRET: must be at least 32 characters[\s\S]*FLUTA_ALERT_EMAIL/,
    );
  });

  it("accepts Termii with all three values, or none outside production", () => {
    expect(parseServerEnv({ ...VALID, ...TERMII })).toMatchObject(TERMII);
    expect(parseServerEnv({ ...VALID, TERMII_API_KEY: "", TERMII_SENDER_ID: "", TERMII_BASE_URL: "" }).TERMII_API_KEY).toBeUndefined();
  });

  it("refuses part of Termii's settings, or none in production", () => {
    expect(() => parseServerEnv({ ...VALID, TERMII_API_KEY: "key" })).toThrow(/set all three, or none/);
    expect(() =>
      parseServerEnv({ ...VALID, NODE_ENV: "production", DATABASE_BRANCH: "production", BETTER_AUTH_URL: "https://fluta.example" }),
    ).toThrow(/required in production/);
  });

  it("refuses a sender ID Termii won't take", () => {
    expect(() => parseServerEnv({ ...VALID, ...TERMII, TERMII_SENDER_ID: "Fluta Laundry!" })).toThrow(/TERMII_SENDER_ID/);
  });

  it("accepts a complete environment", () => {
    expect(parseServerEnv(VALID)).toEqual(VALID);
  });

  it("names every missing variable and points at .env.example", () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL[\s\S]*DATABASE_BRANCH[\s\S]*\.env\.example/);
  });

  it("rejects a non-PostgreSQL URL", () => {
    expect(() => parseServerEnv({ ...VALID, DATABASE_URL: "mysql://localhost/db" })).toThrow(
      /DATABASE_URL: must be a postgresql:\/\/ connection string/,
    );
  });

  it("rejects an unknown branch", () => {
    expect(() => parseServerEnv({ ...VALID, DATABASE_BRANCH: "preview" })).toThrow(/DATABASE_BRANCH/);
  });

  it("rejects a short auth secret and a non-http auth URL", () => {
    expect(() => parseServerEnv({ ...VALID, BETTER_AUTH_SECRET: "short", BETTER_AUTH_URL: "ftp://x" })).toThrow(
      /BETTER_AUTH_SECRET: must be at least 32 characters[\s\S]*BETTER_AUTH_URL: must be an http\(s\) URL/,
    );
  });

  it("requires the R2 settings and an https public URL", () => {
    expect(() => parseServerEnv({ ...VALID, R2_BUCKET: "", R2_PUBLIC_URL: "http://logos.example.com" })).toThrow(
      /R2_BUCKET: is required[\s\S]*R2_PUBLIC_URL: must be an https URL/,
    );
  });

  it("never echoes the connection string in the error", () => {
    expect(() => parseServerEnv({ ...VALID, DATABASE_BRANCH: "preview" })).not.toThrow(/secret/);
  });
});

describe("parseServerEnv: Paystack", () => {
  const TEST_KEY = { PAYSTACK_SECRET_KEY: "sk_test_0123456789abcdef", PAYSTACK_MODE: "test" };
  const LIVE_KEY = { PAYSTACK_SECRET_KEY: "sk_live_0123456789abcdef", PAYSTACK_MODE: "live" };
  const PRODUCTION = { NODE_ENV: "production", DATABASE_BRANCH: "production", BETTER_AUTH_URL: "https://app.fluta.ng", ...TERMII };

  it("allows neither variable outside production", () => {
    expect(parseServerEnv(VALID).PAYSTACK_SECRET_KEY).toBeUndefined();
    expect(parseServerEnv({ ...VALID, PAYSTACK_SECRET_KEY: "", PAYSTACK_MODE: "" }).PAYSTACK_MODE).toBeUndefined();
  });

  it("accepts a test key in test mode on development and test databases", () => {
    expect(parseServerEnv({ ...VALID, ...TEST_KEY })).toMatchObject(TEST_KEY);
    expect(parseServerEnv({ ...VALID, ...TEST_KEY, DATABASE_BRANCH: "test" })).toMatchObject(TEST_KEY);
  });

  it.each(["development", "test"])("refuses a live key on the %s database", (branch) => {
    expect(() => parseServerEnv({ ...VALID, ...LIVE_KEY, DATABASE_BRANCH: branch })).toThrow(
      /a live key \(sk_live_\) is only allowed on the production database/,
    );
    expect(() =>
      parseServerEnv({ ...VALID, ...LIVE_KEY, NODE_ENV: "production", DATABASE_BRANCH: branch, BETTER_AUTH_URL: "https://app.fluta.ng" }),
    ).toThrow(/only allowed on the production database/);
  });

  it("refuses a live key on the production database outside a production server", () => {
    expect(() => parseServerEnv({ ...VALID, ...LIVE_KEY, DATABASE_BRANCH: "production" })).toThrow(/only allowed on the production database/);
  });

  it("requires the mode to agree with the key", () => {
    expect(() => parseServerEnv({ ...VALID, PAYSTACK_SECRET_KEY: "sk_test_0123456789abcdef", PAYSTACK_MODE: "live" })).toThrow(
      /PAYSTACK_MODE: is live but the key is a test key/,
    );
  });

  it("requires both or neither", () => {
    expect(() => parseServerEnv({ ...VALID, PAYSTACK_SECRET_KEY: "sk_test_0123456789abcdef" })).toThrow(/set both, or neither/);
    expect(() => parseServerEnv({ ...VALID, PAYSTACK_MODE: "test" })).toThrow(/set both, or neither/);
  });

  it("refuses something that isn't a secret key, without echoing it", () => {
    const attempt = () => parseServerEnv({ ...VALID, PAYSTACK_SECRET_KEY: "pk_test_publickey123", PAYSTACK_MODE: "test" });
    expect(attempt).toThrow(/PAYSTACK_SECRET_KEY: must be a Paystack secret key/);
    expect(attempt).not.toThrow(/publickey123/);
  });

  it("requires a live key in live mode on the production database", () => {
    expect(parseServerEnv({ ...VALID, ...PRODUCTION, ...LIVE_KEY })).toMatchObject(LIVE_KEY);
    expect(() => parseServerEnv({ ...VALID, ...PRODUCTION })).toThrow(/production requires PAYSTACK_MODE=live and an sk_live_ key/);
    expect(() => parseServerEnv({ ...VALID, ...PRODUCTION, ...TEST_KEY })).toThrow(/production requires PAYSTACK_MODE=live/);
  });
});

describe("parseServerEnv: environments (DATABASE_BRANCH)", () => {
  const LIVE = { PAYSTACK_SECRET_KEY: "sk_live_0123456789abcdef", PAYSTACK_MODE: "live" };
  const TEST_KEY = { PAYSTACK_SECRET_KEY: "sk_test_0123456789abcdef", PAYSTACK_MODE: "test" };
  const STAGING = { NODE_ENV: "production", DATABASE_BRANCH: "staging", BETTER_AUTH_URL: "https://fluta-staging.up.railway.app" };
  const PRODUCTION = { NODE_ENV: "production", DATABASE_BRANCH: "production", BETTER_AUTH_URL: "https://app.fluta.ng" };

  it("accepts the staging branch", () => {
    expect(parseServerEnv({ ...VALID, ...STAGING }).DATABASE_BRANCH).toBe("staging");
  });

  it.each(["http://fluta-staging.up.railway.app", "https://localhost:3000", "http://127.0.0.1:3000"])(
    "requires a public https auth URL on staging, even outside a production server (%s)",
    (url) => {
      for (const nodeEnv of ["production", "development"]) {
        expect(() => parseServerEnv({ ...VALID, NODE_ENV: nodeEnv, DATABASE_BRANCH: "staging", BETTER_AUTH_URL: url })).toThrow(
          /BETTER_AUTH_URL: must be the public https:\/\/ address/,
        );
      }
    },
  );

  it("doesn't require https in development", () => {
    expect(parseServerEnv({ ...VALID, BETTER_AUTH_URL: "http://localhost:3000" }).BETTER_AUTH_URL).toBe("http://localhost:3000");
  });

  it("takes a Paystack test key on staging and refuses a live one", () => {
    expect(parseServerEnv({ ...VALID, ...STAGING, ...TEST_KEY })).toMatchObject(TEST_KEY);
    expect(() => parseServerEnv({ ...VALID, ...STAGING, ...LIVE })).toThrow(/only allowed on the production database/);
  });

  it("lets staging and development leave Paystack and Termii unset", () => {
    expect(parseServerEnv({ ...VALID, ...STAGING }).PAYSTACK_SECRET_KEY).toBeUndefined();
    expect(parseServerEnv({ ...VALID, ...STAGING }).TERMII_API_KEY).toBeUndefined();
    expect(parseServerEnv(VALID).TERMII_API_KEY).toBeUndefined();
  });

  it("still refuses part of Termii's settings on staging", () => {
    expect(() => parseServerEnv({ ...VALID, ...STAGING, TERMII_API_KEY: "key" })).toThrow(/set all three, or none/);
  });

  it("requires Termii and a live Paystack key in production", () => {
    expect(() => parseServerEnv({ ...VALID, ...PRODUCTION, ...LIVE })).toThrow(/TERMII_API_KEY[\s\S]*required in production/);
    expect(() => parseServerEnv({ ...VALID, ...PRODUCTION, ...TERMII })).toThrow(/production requires PAYSTACK_MODE=live/);
    expect(parseServerEnv({ ...VALID, ...PRODUCTION, ...TERMII, ...LIVE }).DATABASE_BRANCH).toBe("production");
  });
});

describe("isStaging", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is true only when DATABASE_BRANCH is staging", () => {
    vi.stubEnv("DATABASE_BRANCH", "staging");
    expect(isStaging()).toBe(true);
    for (const branch of ["development", "test", "production", ""]) {
      vi.stubEnv("DATABASE_BRANCH", branch);
      expect(isStaging()).toBe(false);
    }
  });
});

describe("parseServerEnv in production", () => {
  it("accepts an https:// auth URL", () => {
    expect(parseServerEnv({ ...VALID, ...TERMII, NODE_ENV: "production", BETTER_AUTH_URL: "https://app.fluta.ng" })).toEqual({
      ...VALID,
      ...TERMII,
      BETTER_AUTH_URL: "https://app.fluta.ng",
    });
  });

  it.each(["http://app.fluta.ng", "https://localhost:3000", "http://localhost:3000", "https://127.0.0.1:3000"])(
    "refuses %s in production",
    (url) => {
      expect(() => parseServerEnv({ ...VALID, NODE_ENV: "production", BETTER_AUTH_URL: url })).toThrow(
        /BETTER_AUTH_URL: must be the public https:\/\/ address \(not localhost or 127\.0\.0\.1\) in production/,
      );
    },
  );

  it.each(["http://app.fluta.ng", "http://localhost:3000", "http://127.0.0.1:3000"])("allows %s in development", (url) => {
    expect(parseServerEnv({ ...VALID, NODE_ENV: "development", BETTER_AUTH_URL: url }).BETTER_AUTH_URL).toBe(url);
  });

  it("reports the URL problem alongside schema problems", () => {
    expect(() =>
      parseServerEnv({ ...VALID, NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:3000", EMAIL_FROM: "" }),
    ).toThrow(/EMAIL_FROM: is required[\s\S]*BETTER_AUTH_URL: must be the public https/);
  });
});

describe("isNodeServerStartup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is true when a server starts in the Node.js runtime", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    expect(isNodeServerStartup()).toBe(true);
  });

  it("is false in the Edge runtime", () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    expect(isNodeServerStartup()).toBe(false);
  });

  it("is false while `next build` prerenders, so builds need no secrets", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(isNodeServerStartup()).toBe(false);
  });
});
