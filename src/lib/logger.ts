// The one place Fluta writes logs, so scrubbing or a log service can be added
// here later. Never pass raw tokens, full phone numbers, addresses, or secrets
// (coding-standards.md, Security): log IDs, error classes, and codes instead.
// As a safety net, a tracking link's token is replaced with "[token]" in
// anything logged here (messages, text, and errors).
export const logger = {
  error(message: string, ...details: unknown[]): void {
    console.error(redactTrackingTokens(message), ...details.map(redactDetail));
  },
  warn(message: string, ...details: unknown[]): void {
    console.warn(redactTrackingTokens(message), ...details.map(redactDetail));
  },
};

const TRACKING_PATH = /\/o\/[^/?#\s"'<>]+/g;

// "/o/abc…xyz/price-update" → "/o/[token]/price-update", anywhere in the text.
export function redactTrackingTokens(text: string): string {
  return text.replace(TRACKING_PATH, "/o/[token]");
}

function redactDetail(detail: unknown): unknown {
  if (typeof detail === "string") return redactTrackingTokens(detail);
  if (detail instanceof Error) {
    const copy = new Error(redactTrackingTokens(detail.message));
    copy.name = detail.name;
    copy.stack = detail.stack && redactTrackingTokens(detail.stack);
    return copy;
  }
  return detail;
}
