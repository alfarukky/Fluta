# Feature 08 — Staff Management

## Overview

Owners invite staff by email, see who has access, and deactivate or reactivate staff. Invited people accept through a private link, set their name and password, and land in the workspace. This feature also adds Fluta's first email sending and password reset. It reuses Feature 03's `users.ts` and membership function (one active membership per user) and Feature 07's shared edit check.

## Requirements

### Access (reuse Features 03 and 07)

- `/settings/staff` is owner-only: the page calls `requireStoreMember({ role: "OWNER" })`; staff get the no-access page
- Every staff-management action calls the shared edit check from Feature 07 (`requireOwnerCanEdit()` or equivalent); the store comes only from the membership
- A membership or invitation ID from the client is only acted on if it belongs to that store
- Settings gets simple sub-navigation between **Store** (Feature 05's page) and **Staff**
- If `requireStoreMember()` ever finds more than one active membership for a user, it refuses access (no-access page) and logs an error. It never picks one (updates Feature 03's helper)

### Schema change (Ask First)

- Add `StoreInvitation` as in the overview's schema (email, role, `tokenHash`, `invitedByUserId`, `expiresAt`, `acceptedAt`, `revokedAt`), linked to its store with the composite store-scoped pattern, in one migration

### Inviting staff

- Owner enters an email; the role is always **Staff** (owners are invited by Fluta admins in Feature 23; no role changes in the MVP)
- Refused if the email already has an active membership (at this store or another store, per the one-membership rule), with one generic message: "This email can't be invited. It may already be in use." The message never says which store. A pending invitation to this store offers Resend instead
- The invitation token is random (at least 128 bits), only its SHA-256 hash is stored, and it expires after **7 days**
- After creating it, the owner sees the invite link **once**, with **Copy link**, so it can also be shared by WhatsApp; an email is sent as well (see Email)
- **Resend** issues a new token and revokes the previous one; **Revoke** cancels a pending invitation
- **Resend** also shows the new link once, with Copy; if its email fails, the owner sees "New invitation created, but the email couldn't be sent. Copy the link to share it."
- One `normalizeEmail()` helper (trim, lowercase) is used everywhere an email is saved or looked up: `users.ts`, invitations, the "already in use" check, and acceptance. Check that the Feature 03 seed and `users.ts` already store lowercase emails; if not, fix them here

### Accepting an invitation

- Public page `/invite/[token]` (no sign-in required); it sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, is `noindex`, and the raw token is never logged
- An invalid, expired, revoked, or already-used link shows one plain message: "This invitation is no longer valid. Ask the store owner for a new one."
- A valid link shows the store name, the role, and the invited email **read-only**
  - **New email:** form for name and password (minimum `MIN_PASSWORD_LENGTH`). On submit, in one transaction: create the user through `users.ts`, create the membership through the membership function, and set `acceptedAt`. Then sign the person in and go to `/overview`
  - **Email already has an account** (without an active membership): they must sign in as that account; then the membership is created and `acceptedAt` set in one transaction
  - If the email gained an active membership elsewhere since the invite was sent, acceptance is refused with a clear message
  - The email always comes from the invitation, never from the request. For a new account, the user is created with the invitation's email; for an existing account, the signed-in user's email must match the invitation's email (both normalized), otherwise acceptance is refused with "This invitation is for a different email. Sign in with that email to accept it."
- Acceptance re-checks everything on the server at submit time (token valid, not expired, not used, store still editable)
- Acceptance first **claims** the invitation with a single conditional update (set `acceptedAt` only where it is still unaccepted, unrevoked, and unexpired) inside the same transaction that creates the user and membership. If nothing was claimed, show the "no longer valid" message; if anything later fails, the whole transaction, including the claim, is rolled back

### Staff list

- Shows members and pending invitations: name (or "Invited"), email, role, status (**Active**, **Deactivated**, **Invited**, **Invite expired**), and invite date or join date
- Owners appear in the list but have no actions; an owner cannot deactivate themselves or another owner
- Actions:
  - **Deactivate staff** (confirmation dialog, because it signs the person out): sets the membership inactive with `deactivatedAt`, revokes **all** that user's sessions through Better Auth, and writes an `AuditEvent` (`STAFF_DEACTIVATED`)
  - **Reactivate staff:** sets `isActive = true` and clears `deactivatedAt` on the same membership, unless the user now has an active membership elsewhere; writes an `AuditEvent` (`STAFF_REACTIVATED`), so the history is kept in audit events
  - **Resend** for pending and expired invitations; **Revoke** for pending ones only
- Order history and anything the person recorded stay intact after deactivation
- **Keeping the list tidy:** invitations are never deleted, but the list hides revoked and replaced (resent) invitations, accepted ones (the person appears as a member instead), and expired invitations older than 30 days. Expired invitations within 30 days show "Invite expired" with Resend
- Desktop: table; mobile: stacked cards; empty state when the store has no staff yet, with an "Invite staff" action

### Email (first use in Fluta)

- Resend's official SDK (`resend`), sending from Fluta's verified domain, behind one small mailer in `src/server/integrations/email.ts`
- New variables in `env.ts`, `.env.example`, `.env.local`, and `.env.test`: `RESEND_API_KEY`, `EMAIL_FROM` (an address on the verified domain)
- Emails are plain and short, start with the store's name, and contain the link and its expiry
- Sending happens after the database change commits; a failed send never undoes the invitation. The owner sees "Invitation created, but the email couldn't be sent. Copy the link to share it." and can Resend
- Tests use a fake mailer and never call the Resend API. Development may use the real Resend key, sending only to addresses you control
- Package additions (Resend) are an Ask First item

### Password reset

- "Forgot password?" on the sign-in page uses Better Auth's built-in reset flow, sending the email through the same mailer
- The response is always the same ("If an account exists for this email, we've sent a reset link"), whether or not the email exists
- Reset links expire after **1 hour**, set explicitly in Better Auth's config (not left to the default); the reset route is covered by Better Auth's rate limiting
- One password rule, `MIN_PASSWORD_LENGTH = 8`, defined once and used by Better Auth's config (sign-in and password reset), the invitation acceptance form, and `users.ts`
- After a reset, all of that user's other sessions are revoked

### Fulfilment time picker (updates Feature 07)

- Replace the opening/closing time lists with three small controls: **hour** (1–12), **minutes** (00, 15, 30, 45), and **AM/PM**. Keeps the 15-minute step; no list longer than 12 items
- Times are still stored as 24-hour `HH:MM`; only display and input change. Validation (closing after opening) is unchanged
- A `time.ts` helper converts between stored `HH:MM` and 12-hour display ("08:00" ↔ "8:00 AM"), with unit tests including 12:00 PM, 12:00 AM, and 12:15 AM
- The pickup-window preview shows 12-hour times ("8:00 AM–10:00 AM")
- Record in the commit message and history that Feature 07's fulfilment page was updated

## Not in this feature

- Inviting owners and onboarding stores (Fluta admin, Feature 23)
- Changing roles, multiple owners, or multi-store accounts
- Order-related emails and SMS (Feature 15)
- Read-only access for Cancelled stores (still **(Open)**)

## Done when

- Unit tests: invitation status (Invited, Invite expired, accepted, revoked), token generation and hashing; 12-hour time conversion
- Integration tests:
  - staff cannot invite, resend, revoke, deactivate, or reactivate
  - a FreshFold owner cannot act on a CleanWave membership or invitation, even by sending its ID
  - an email with an active membership elsewhere cannot be invited, and cannot accept an older invitation
  - accepting creates exactly one user and one membership; using the same link again fails
  - two acceptance requests for the same link sent at once produce exactly one user and one membership; the other gets the "no longer valid" message
  - a user signed in with a different email cannot accept someone else's invitation
  - a user with two active memberships (inserted directly in the test database) gets the no-access page, and an error is logged
  - expired, revoked, and replaced (resent) links fail
  - deactivation revokes the user's existing sessions and the next request is refused; reactivation restores access
  - an owner cannot be deactivated
  - a failed email send keeps the invitation
  - an expired invitation can be resent; revoked, replaced, accepted, and 30-day-old expired invitations are hidden from the list but not deleted
  - password reset gives the same response for known and unknown emails
  - a 7-character password is refused by both invitation acceptance and password reset
  - inviting `  John@Example.COM ` stores `john@example.com`; after accepting, the person can sign in typing any capitalisation
  - a failed email on Resend still shows the new link
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** at ~360px and desktop, light and dark: owner invites staff, copies the link, opens it in a fresh browser, sets name and password, lands on `/overview` as staff; owner sees the person as Active; owner deactivates them and the staff browser is signed out on its next action; reactivate; resend and revoke an invite; invalid link message; forgot-password flow; on `/fulfilment`, set hours with the hour/minute/AM-PM controls and see 12-hour times in the preview
- **Next.js DevTools:** no runtime or build errors on `/settings/staff`, `/invite/[token]`, and the sign-in page
- **Neon MCP** (`development`, read-only): invitations store only token hashes; accepted invitation has `acceptedAt`; deactivated membership has `isActive = false` and `deactivatedAt`; audit events written

## References

- @context/project-overview.md (Staff accounts and roles, Auth Flow → invitation rules, Data Model → `StoreInvitation`, `Membership`, `AuditEvent`)
- @context/coding-standards.md (Security)
- @context/features/03-auth-access-spec.md (`users.ts`, membership function, one-membership rule, sign-up blocked)
- @context/features/07-fulfilment-settings-spec.md (shared edit check)
- Better Auth docs (session revocation, password reset): check current APIs with Context7
