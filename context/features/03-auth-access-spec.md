# Feature 03 — Authentication & Store Access

## Overview

Owners, staff, and Fluta admins can sign in with email and password. Every workspace request checks the user's store membership, role, and store access. Feature 02 deliberately left out `User`, `Membership`, and the Better Auth tables; this feature adds them, replaces the seed's placeholder user IDs with real users, and builds the sign-in page from the screenshot.

## Requirements

### Schema (one migration, e.g. `auth_and_membership`)

- Add `User` and `Membership` exactly as in the overview's draft schema, including `PlatformRole`, `StoreRole`, and the `Store.memberships` relation
- Generate Better Auth's models (session, account, verification, and the rate-limit table) with its CLI **into a separate output file**, never directly into `schema.prisma`. Treat that output as input to reconcile with the existing schema, not as a replacement:
  - Merge Better Auth's required user fields into the existing `User` model, keeping `platformRole` and the `memberships` relation. Relations stay in Prisma only; they are never declared in Better Auth's config
  - Do **not** declare `platformRole` in Better Auth's `additionalFields`. If a later need requires it, it must be marked non-settable by input
  - Check the current CLI command and Prisma adapter setup with Context7 before starting
- Apply the overview's `QuoteRevision` change: `createdByUserId` optional, new required `createdByActor` (`CUSTOMER` for online bookings, `STAFF` for staff-created revisions)
- Add a CHECK constraint (hand-edited migration via `--create-only`): `STAFF` requires `createdByUserId`, `CUSTOMER` requires it to be NULL, and no other actor value is allowed:

  ```sql
  ALTER TABLE "QuoteRevision" ADD CONSTRAINT "QuoteRevision_creator_check" CHECK (
    ("createdByActor" = 'STAFF'    AND "createdByUserId" IS NOT NULL)
    OR
    ("createdByActor" = 'CUSTOMER' AND "createdByUserId" IS NULL)
  );
  ```
- `StoreInvitation` is **not** added here (Feature 08)

### Better Auth

- Email/password with database sessions, using Better Auth's Prisma adapter with the **existing** client from `src/server/data/client.ts` (no second Prisma client)
- **No Better Auth endpoint may create a user.** Configure `disableSignUp: true`, add `/sign-up/email` to `disabledPaths`, and add a `databaseHooks.user.create.before` hook that rejects every user creation. No social providers or user-creating plugins
- **Users are created only by Fluta's server code**, through one function in `src/server/data/users.ts` that writes the `User` and its credential `Account` in one transaction, hashing the password with Better Auth's password hasher (confirm the API with Context7). The seed uses it now; invitation acceptance (Feature 08) will call it later
- Rate limiting: `enabled: true` in every environment, `storage: "database"` (the generated `rateLimit` model is added in this feature's migration; no Redis)
- Sign-in policy: `customRules` for `/sign-in/email` = **10 attempts per 5 minutes per IP**. Other auth routes keep Better Auth's defaults
- Configure `advanced.ipAddress` so the real client IP is read from the proxy header, not the proxy's own address; confirm the exact header for Railway at deployment
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` added to `src/lib/env.ts` and `.env.example`, and set in `.env.local` and `.env.test` (the startup check and integration tests both validate them)

### Seed

- **Seed users first:** the seed creates users through the `users.ts` function **before** any store data, then builds memberships, orders, revisions, payments, and refunds using their real generated IDs:
  - FreshFold: owner **Ada Okafor** and one staff member
  - CleanWave: one owner
  - One Fluta admin (`platformRole = FLUTA_ADMIN`, no membership)
  - All using `SEED_USER_PASSWORD`; the seed still refuses to run against `production`
- Seed passwords come from `SEED_USER_PASSWORD` in `.env.local` and `.env.test` (one password for all seeded users); `.env.example` lists it empty. It is read and validated by the seed only, never by the app's `env.ts`, and never set in production. The seed stops with a clear message if it is missing. No passwords are hard-coded in `seed.ts` or tests
- **Remove all Feature 02 placeholder IDs** (`seed-user-freshfold-owner`, `seed-user-cleanwave-owner`, `online-booking`). Online-booking revisions use `createdByUserId = null` and `createdByActor = CUSTOMER`
- The seed ends with a check that every actor ID in the seeded data (`createdByUserId`, `recordedByUserId`, `voidedByUserId`, `actorUserId`, and similar) matches an existing user, and fails loudly if not
- Seeding twice still works

### Sign-in

- Sign-in page at `/sign-in` as in the screenshot (green brand panel left, form right, show/hide password)
  - Label reads "Store workspace", not "Owner workspace", because staff sign in here too
  - The brand panel is hidden on mobile
  - Works in light and dark themes using the Feature 01 tokens; uses the `Logo` component
  - Wrong credentials show one generic error ("Email or password is incorrect")
- After sign-in:
  - Store member → `/overview` (placeholder heading until Feature 04)
  - Fluta admin → `/admin` (placeholder heading "Fluta admin")
- Sign out ends the session and returns to `/sign-in`

### Access helpers

- Server helpers in `src/server/auth/`:
  - `getSession()`
  - `requireStoreMember({ role? })` — returns user, membership, store; checks an active membership on every call (never cached) and redirects or returns a 403 result
  - `requireFlutaAdmin()` — reads `platformRole` from the database on every request, never from the session
- One active membership per user in the MVP, enforced by the single function that creates memberships (it refuses a second active one). The store always comes from that membership, never from the URL, request body, query string, or cookies.
- `src/server/domain/store-access.ts`: `getStoreAccess(store, subscription, now)` returning the capabilities from the overview's access table, with unit tests for every store status × subscription status combination
- Workspace and admin layouts call these helpers server-side; unauthenticated users are redirected to `/sign-in`

## Not in this feature

- Password reset and invitations, including `StoreInvitation` (Features 08 and 15, which add email)
- Staff deactivation screens and session revocation (Feature 08). A deactivated membership is already denied in this feature; Feature 08 adds the screens and signs the user out immediately.
- The workspace sidebar and top bar (Feature 04)

## Done when

- `npx prisma migrate status` is in sync and the overview's `User`, `Membership`, and `QuoteRevision` match `schema.prisma`
- No placeholder user IDs remain in the seed or test fixtures
- Seeding from scratch succeeds and the actor-ID check passes
- Unit tests cover every `getStoreAccess` combination
- Integration tests: a staff user cannot open admin pages; a CleanWave user cannot load a FreshFold workspace page; a deactivated membership is rejected even with a valid session
- `POST /api/auth/sign-up/email` fails and creates no `User` row, including when the body contains `platformRole`
- Seeded users can sign in with `SEED_USER_PASSWORD`
- Integration tests: a `STAFF` revision without `createdByUserId` is rejected, and a `CUSTOMER` revision with one is rejected
- The 11th sign-in attempt within 5 minutes from the same IP is rejected, and the counter is stored in the `rateLimit` table
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** sign-in at ~360px and desktop, light and dark themes; wrong password shows the generic error; owner lands on `/overview`, admin on `/admin`; sign-out returns to `/sign-in`; visiting `/overview` signed out redirects to `/sign-in`
- **Neon MCP** (`development` branch, read-only): Better Auth tables, `User`, and `Membership` exist; seeded users and memberships are present; no rows contain placeholder IDs
- **Next.js DevTools:** no runtime or build errors on `/sign-in`, `/overview`, and `/admin`

## References

- @context/screenshots/sign-in.png
- @context/project-overview.md (Auth Flow, Staff accounts and roles, Monetization access table, Data Model)
- @context/coding-standards.md (Security, Database)
- @context/features/02-database-seed-spec.md
- Better Auth docs: https://www.better-auth.com/docs (check current APIs with Context7)
- Prisma 7 docs: https://www.prisma.io/docs/orm/v7 (never Prisma 8)
