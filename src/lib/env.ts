// The only module that reads process.env (see coding-standards.md).
// Secrets added later get Zod validation here; NODE_ENV is set by Next.js itself.

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}
