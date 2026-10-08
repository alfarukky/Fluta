import { describe, expect, it } from "vitest";

import { generateToken, hashToken, isWellFormedToken } from "./tokens";

describe("tokens", () => {
  it("are random 256-bit base64url strings", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      expect(isWellFormedToken(token)).toBe(true);
    }
  });

  it("are stored as a SHA-256 hex hash that differs from the token", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(generateToken())).not.toBe(hash);
  });

  it("matches a known SHA-256 value", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("refuses text that can't be a token", () => {
    for (const text of ["", "short", "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`]) {
      expect(isWellFormedToken(text)).toBe(false);
    }
  });
});
