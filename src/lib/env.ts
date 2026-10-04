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

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}
