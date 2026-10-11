// The one place Fluta writes logs, so scrubbing or a log service can be added
// here later. Never pass raw tokens, full phone numbers, addresses, or secrets
// (coding-standards.md, Security): log IDs, error classes, and codes instead.
export const logger = {
  error(message: string, ...details: unknown[]): void {
    console.error(message, ...details);
  },
  warn(message: string, ...details: unknown[]): void {
    console.warn(message, ...details);
  },
};
