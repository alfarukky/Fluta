// The one form an email address is saved and looked up in: trimmed and
// lowercased. Used by users.ts, invitations, the "already in use" check, and
// invitation acceptance, so "  John@Example.COM " and "john@example.com" are
// the same person everywhere.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
