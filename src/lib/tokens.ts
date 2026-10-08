import { createHash, randomBytes } from "node:crypto";

// Private-link tokens (staff invitations now, order tracking links later):
// 256 random bits, written as 43 base64url characters. Only the SHA-256 hash
// is stored; the raw token exists in the link alone and is never logged.

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// True when the text could be a token we issued; anything else is refused
// without a database lookup.
export function isWellFormedToken(text: string): boolean {
  return TOKEN_PATTERN.test(text);
}
