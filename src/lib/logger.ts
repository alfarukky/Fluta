// The one place Fluta writes logs, so scrubbing or a log service can be added
// here later. Never pass raw tokens, full phone numbers, addresses, or secrets
// (coding-standards.md, Security): log IDs, error classes, and codes instead.
// As a safety net, a tracking link's token is replaced with "[token]" in
// anything logged here (messages, text, and errors), and fields on the
// redaction list are replaced with "[redacted]" in logged objects.
export const logger = {
  error(message: string, ...details: unknown[]): void {
    console.error(redactTrackingTokens(message), ...details.map((detail) => redactDetail(detail)));
  },
  warn(message: string, ...details: unknown[]): void {
    console.warn(redactTrackingTokens(message), ...details.map((detail) => redactDetail(detail)));
  },
};

const TRACKING_PATH = /\/o\/[^/?#\s"'<>]+/g;

// "/o/abc…xyz/price-update" → "/o/[token]/price-update", anywhere in the text.
export function redactTrackingTokens(text: string): string {
  return text.replace(TRACKING_PATH, "/o/[token]");
}

// Fields never written to logs, matched ignoring case and at any depth
// ("pickupLatitude" matches "latitude"): a customer's exact location.
export const REDACTED_FIELDS = ["latitude", "longitude"] as const;

const MAX_REDACT_DEPTH = 5;

function isRedactedField(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_FIELDS.some((field) => lower.endsWith(field));
}

function redactDetail(detail: unknown, depth = 0): unknown {
  if (typeof detail === "string") return redactTrackingTokens(detail);
  if (detail instanceof Error) {
    const copy = new Error(redactTrackingTokens(detail.message));
    copy.name = detail.name;
    copy.stack = detail.stack && redactTrackingTokens(detail.stack);
    return copy;
  }
  if (typeof detail !== "object" || detail === null || depth >= MAX_REDACT_DEPTH) return detail;
  if (Array.isArray(detail)) return detail.map((item) => redactDetail(item, depth + 1));
  // Plain objects only: anything else (a Date, a Prisma Decimal) is logged as it is.
  const prototype = Object.getPrototypeOf(detail);
  if (prototype !== Object.prototype && prototype !== null) return detail;
  return Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [key, isRedactedField(key) ? "[redacted]" : redactDetail(value, depth + 1)]),
  );
}
