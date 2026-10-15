import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CLIENT_IP_HEADER, getClientIp, hashClientIp } from "./client-ip";

const SECRET = "a-booking-ip-secret-of-at-least-32-characters";

describe("getClientIp", () => {
  it("reads only the header the hosting proxy sets", () => {
    expect(getClientIp(new Headers({ [CLIENT_IP_HEADER]: " 102.89.1.7 " }))).toBe("102.89.1.7");
    expect(getClientIp(new Headers({ [CLIENT_IP_HEADER]: "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("ignores X-Forwarded-For, which the visitor can add to", () => {
    expect(getClientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBeNull();
  });

  it("gives null for anything that isn't an IP address", () => {
    expect(getClientIp(new Headers({ [CLIENT_IP_HEADER]: "1.2.3.4, 5.6.7.8" }))).toBeNull();
    expect(getClientIp(new Headers({ [CLIENT_IP_HEADER]: "" }))).toBeNull();
  });
});

describe("hashClientIp", () => {
  it("is an HMAC keyed with the secret, never the address itself", () => {
    const hash = hashClientIp("102.89.1.7", SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("102.89");
    expect(hash).toBe(hashClientIp("102.89.1.7", SECRET));
  });

  it("differs from a plain SHA-256 and between secrets", () => {
    const plain = createHash("sha256").update("102.89.1.7").digest("hex");
    expect(hashClientIp("102.89.1.7", SECRET)).not.toBe(plain);
    expect(hashClientIp("102.89.1.7", `${SECRET}-other`)).not.toBe(hashClientIp("102.89.1.7", SECRET));
  });

  it("puts every unknown address in one shared bucket", () => {
    expect(hashClientIp(null, SECRET)).toBe(hashClientIp(null, SECRET));
    expect(hashClientIp(null, SECRET)).not.toBe(hashClientIp("102.89.1.7", SECRET));
  });
});
