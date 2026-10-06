import { afterEach, describe, expect, it, vi } from "vitest";

import { isNodeServerStartup, parseServerEnv } from "./env";

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
};

describe("parseServerEnv", () => {
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
    expect(() => parseServerEnv({ ...VALID, DATABASE_BRANCH: "staging" })).toThrow(/DATABASE_BRANCH/);
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
    expect(() => parseServerEnv({ ...VALID, DATABASE_BRANCH: "staging" })).not.toThrow(/secret/);
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
