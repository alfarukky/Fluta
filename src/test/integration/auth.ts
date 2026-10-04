import { randomInt } from "node:crypto";

import { getAuth } from "@/server/auth/auth";

// A random private address per call, so tests never share a rate-limit bucket
// (with each other or with earlier runs).
export function randomIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

// A request through Better Auth's HTTP handler, exactly as the browser sends
// it: origin check, disabled paths, and rate limiting all apply.
export async function postToAuth(path: string, body: unknown, ip = randomIp()): Promise<Response> {
  const origin = process.env.BETTER_AUTH_URL ?? "";
  return getAuth().handler(
    new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-real-ip": ip },
      body: JSON.stringify(body),
    }),
  );
}

// Signs in through the endpoint and returns request headers carrying the
// session cookie, as the browser would send them on the next request.
export async function signInHeaders(email: string, password = seedPassword()): Promise<Headers> {
  const response = await postToAuth("/sign-in/email", { email, password });
  if (!response.ok) throw new Error(`Sign-in as ${email} failed with ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

export function seedPassword(): string {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) throw new Error(".env.test is missing SEED_USER_PASSWORD.");
  return password;
}
