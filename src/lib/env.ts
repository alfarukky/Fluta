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
  // The app's public origin, e.g. http://localhost:3000.
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
  // SMTP for Fluta's emails (Gmail with an app password). Port 465 uses TLS
  // from the start; any other port upgrades with STARTTLS. Tests replace the
  // mailer with a fake, so .env.test only needs placeholder values.
  SMTP_HOST: z.string().min(1, "is required"),
  SMTP_PORT: z.coerce.number({ error: "must be a port number" }).int().min(1).max(65535),
  SMTP_USER: z.string().min(1, "is required"),
  SMTP_PASS: z.string().min(1, "is required"),
  // The sender, e.g. "Fluta <you@gmail.com>". Gmail only sends as the signed-in account.
  EMAIL_FROM: z.string().min(1, "is required"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing environment variables:\n${problems}\n` +
        "Copy .env.example to .env.local and fill in the values.",
    );
  }
  return result.data;
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

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}
