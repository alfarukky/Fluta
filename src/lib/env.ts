// The only module that reads process.env (see coding-standards.md).
// NODE_ENV is set by Next.js itself; everything else is validated with Zod.
import { z } from "zod";

const postgresUrlSchema = z.url({
  protocol: /^postgres(ql)?$/,
  error: "must be a postgresql:// connection string",
});

const serverEnvSchema = z.object({
  // Pooled Neon URL (host contains `-pooler`), used by the app at runtime.
  DATABASE_URL: postgresUrlSchema,
  // Which Neon branch DATABASE_URL points at. The seed refuses `production`;
  // integration tests require `test`.
  DATABASE_BRANCH: z.enum(["development", "test", "production"]),
  // Signs Better Auth's session cookies. Generate with `openssl rand -base64 32`.
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  // The app's public origin, e.g. http://localhost:3000. Every link Fluta
  // emails or shows is built from it. In production it must be https and
  // not localhost (checked in parseServerEnv).
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }),
  // Cloudflare R2 (S3 API) for store logos. Development and test use their
  // own bucket, never production's; tests replace R2 with a fake.
  R2_ACCOUNT_ID: z.string().min(1, "is required"),
  R2_ACCESS_KEY_ID: z.string().min(1, "is required"),
  R2_SECRET_ACCESS_KEY: z.string().min(1, "is required"),
  R2_BUCKET: z.string().min(1, "is required"),
  // The bucket's public address (r2.dev or a custom domain). Logos are served
  // from here, never through the app's own origin.
  R2_PUBLIC_URL: z.url({ protocol: /^https$/, error: "must be an https URL" }),
  // Resend API key for Fluta's emails. Tests replace the mailer with a fake,
  // so .env.test only needs a placeholder value.
  RESEND_API_KEY: z.string().min(1, "is required"),
  // The sender on Resend's verified domain, e.g. "Fluta <noreply@yourdomain>".
  EMAIL_FROM: z.string().min(1, "is required"),
  // Keys the HMAC of a booking's IP address (online booking limits). A plain
  // hash isn't enough: every IP address can be guessed and hashed. Generate
  // with `openssl rand -base64 32`.
  BOOKING_IP_SECRET: z.string().min(32, "must be at least 32 characters"),
  // Termii, for customer SMS. All three or none: without them, development
  // marks messages as sent without sending them (production refuses to
  // start, see parseServerEnv). Tests never set them. The base URL is the
  // account's own, shown on Termii's dashboard. The sender ID is Fluta's one
  // registered sender name.
  TERMII_API_KEY: optionalText(),
  TERMII_SENDER_ID: optionalText().pipe(
    z.string().regex(/^[A-Za-z0-9]{3,11}$/, "must be 3 to 11 letters or digits").optional(),
  ),
  TERMII_BASE_URL: optionalText().pipe(z.url({ protocol: /^https$/, error: "must be an https URL" }).optional()),
  // Protects /api/cron/messages: the host's scheduler sends it as a bearer
  // token. Generate with `openssl rand -base64 32`.
  CRON_SECRET: z.string().min(32, "must be at least 32 characters"),
  // Where Fluta's own alerts go (a store nearing its daily booking SMS cap).
  FLUTA_ALERT_EMAIL: z.email("must be an email address"),
  // Paystack, for online payments. One secret key signs API calls and
  // webhooks. Test keys (sk_test_) everywhere except the production database,
  // which requires a live key (checked in parseServerEnv). Unset outside
  // production: online payments are then unavailable. Tests never set them.
  PAYSTACK_SECRET_KEY: optionalText().pipe(
    z.string().regex(/^sk_(test|live)_\S+$/, "must be a Paystack secret key (sk_test_… or sk_live_…)").optional(),
  ),
  PAYSTACK_MODE: optionalText().pipe(z.enum(["test", "live"], "must be test or live").optional()),
});

// An unset or blank variable is undefined.
function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined);
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  const ruleProblems = [...productionUrlProblems(source), ...termiiProblems(source), ...paystackProblems(source)];
  if (result.success && ruleProblems.length === 0) return result.data;

  const problems = [
    ...(result.success ? [] : result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)),
    ...ruleProblems,
  ].join("\n");
  throw new Error(
    `Invalid or missing environment variables:\n${problems}\n` +
      "Copy .env.example to .env.local and fill in the values.",
  );
}

// Links in emails and on screen are built from BETTER_AUTH_URL, so a
// production server must never start with a local or plain-http address.
function productionUrlProblems(source: Record<string, string | undefined>): string[] {
  const url = source.BETTER_AUTH_URL;
  if (source.NODE_ENV !== "production" || url === undefined) return [];
  if (url.startsWith("https://") && !url.includes("localhost") && !url.includes("127.0.0.1")) return [];
  return ["  - BETTER_AUTH_URL: must be the public https:// address (not localhost or 127.0.0.1) in production"];
}

// Termii is all or nothing, and production always sends real SMS.
function termiiProblems(source: Record<string, string | undefined>): string[] {
  const names = ["TERMII_API_KEY", "TERMII_SENDER_ID", "TERMII_BASE_URL"] as const;
  const set = names.filter((name) => source[name]?.trim());
  if (set.length === names.length) return [];
  if (set.length === 0 && source.NODE_ENV !== "production") return [];
  return [`  - ${names.join(", ")}: set all three${source.NODE_ENV === "production" ? " (required in production)" : ", or none"}`];
}

// Live money never touches a development or test database, and the
// production database never takes test payments. The key itself is never
// echoed, only which kind it is.
function paystackProblems(source: Record<string, string | undefined>): string[] {
  const key = source.PAYSTACK_SECRET_KEY?.trim();
  const mode = source.PAYSTACK_MODE?.trim();
  const keyMode = key?.startsWith("sk_live_") ? "live" : key?.startsWith("sk_test_") ? "test" : undefined;
  const production = source.NODE_ENV === "production" && source.DATABASE_BRANCH === "production";

  if (production) {
    if (keyMode === "live" && mode === "live") return [];
    return ["  - PAYSTACK_SECRET_KEY, PAYSTACK_MODE: production requires PAYSTACK_MODE=live and an sk_live_ key"];
  }
  if (!key && !mode) return [];
  const problems: string[] = [];
  if (keyMode === "live") {
    problems.push("  - PAYSTACK_SECRET_KEY: a live key (sk_live_) is only allowed on the production database");
  }
  if (!key || !mode) {
    problems.push("  - PAYSTACK_SECRET_KEY, PAYSTACK_MODE: set both, or neither");
  } else if (keyMode && keyMode !== mode) {
    problems.push(`  - PAYSTACK_MODE: is ${mode} but the key is a ${keyMode} key`);
  }
  return problems;
}

export interface PaystackConfig {
  secretKey: string;
  mode: "test" | "live";
}

// Null when Paystack isn't configured: online payments are unavailable.
export function getPaystackConfig(): PaystackConfig | null {
  const { PAYSTACK_SECRET_KEY, PAYSTACK_MODE } = getServerEnv();
  if (!PAYSTACK_SECRET_KEY || !PAYSTACK_MODE) return null;
  return { secretKey: PAYSTACK_SECRET_KEY, mode: PAYSTACK_MODE };
}

export interface TermiiConfig {
  apiKey: string;
  senderId: string;
  baseUrl: string;
}

// Null when Termii isn't configured (development and tests).
export function getTermiiConfig(): TermiiConfig | null {
  const { TERMII_API_KEY, TERMII_SENDER_ID, TERMII_BASE_URL } = getServerEnv();
  if (!TERMII_API_KEY || !TERMII_SENDER_ID || !TERMII_BASE_URL) return null;
  return { apiKey: TERMII_API_KEY, senderId: TERMII_SENDER_ID, baseUrl: TERMII_BASE_URL };
}

// Validated lazily (and once) so modules that only need isDevelopment() don't
// require database variables; src/instrumentation-node.ts calls this at startup.
export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}

// True when a Next.js server is starting in the Node.js runtime, and not while
// `next build` prerenders pages (builds must work without secrets, e.g. in CI).
export function isNodeServerStartup(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build";
}

// For next.config.ts, which runs during `next build` without secrets: the R2
// public address if it is set and valid, otherwise undefined (never throws).
export function readR2PublicUrl(): URL | undefined {
  const parsed = serverEnvSchema.shape.R2_PUBLIC_URL.safeParse(process.env.R2_PUBLIC_URL);
  return parsed.success ? new URL(parsed.data) : undefined;
}

// The seeded users' password, for the seed and integration tests only. Not in
// ServerEnv: the app never needs it, and production never sets it.
export function readSeedUserPassword(): string | undefined {
  return process.env.SEED_USER_PASSWORD;
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}
