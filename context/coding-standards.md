# Coding Standards

These rules apply to all Fluta code. Product rules live in `project-overview.md`; rules for working with AI assistants live in `ai-interactions.md`. This file covers how the code itself is written. If these files ever conflict, stop and ask.

## TypeScript

- Strict mode enabled
- No `any` types - use proper typing or `unknown`
- Define interfaces for all props, API responses, and data models
- Use type inference where obvious, explicit types where helpful
- Use the Prisma-generated types for database models; do not hand-write duplicates
- Use TypeScript enums only through Prisma's generated enums (`OrderStage`, `PaymentStatus`, …); elsewhere use string literal unions
- Money is always an integer number of **kobo** (`number`, never a float); quantities are whole numbers (`number` in code, stored in Prisma `Decimal` columns as text such as `"3"`)
- Never assert types (`as`) on external input; parse it with Zod instead

## React

- Functional components only (no class components)
- Use hooks for state and side effects
- Keep components focused - one job per component
- Extract reusable logic into custom hooks
- Every screen handles loading, empty, error, and success states
- **Forms with errors scroll to the problem.** When a form is submitted with errors, it scrolls to the first invalid field (clear of fixed headers, and inside the drawer or dialog when the form is in one), focuses it, and shows its message beneath it. Every invalid field is marked with `aria-invalid` and linked to its message. This applies to errors from both the browser and the server, and uses an instant jump when the user has reduced motion turned on. All forms use one shared helper for this
  - Exceptions: the sign-in page and small forms of one or two fields that are fully visible without scrolling. These still show messages beneath their fields, but don't need the scroll
- Status is never shown by colour alone; every badge has a text label

## Next.js

- Server components by default
- Only use `'use client'` when needed (interactivity, hooks, browser APIs)
- Use Server Actions for form submissions and simple mutations from the web app
- Use API routes (`src/app/api/...`) when you need:
  - Webhooks (Paystack)
  - Scheduled jobs (message retry job at `/api/cron/messages`)
  - File uploads (store logos)
  - Specific HTTP status codes or headers
  - Endpoints for future mobile clients, under the versioned prefix `/api/v1/...`
  - Third-party integrations
- Otherwise, fetch data in server components **through the data-access layer** (see Module Boundaries), never by calling Prisma directly
- Dynamic routes for item/collection pages
- Server Actions and route handlers are thin: parse input, check access, call a service, return a result. Business rules never live in them, so the web app and a future `/api/v1` client share the same logic

## Tailwind CSS v4

**CRITICAL**: We are using Tailwind CSS v4, which uses CSS-based configuration.

- **DO NOT** create `tailwind.config.ts` or `tailwind.config.js` files (those are for v3)
- All theme configuration must be done in CSS using the `@theme` directive in `src/app/globals.css`
- Use CSS custom properties for colors, spacing, etc.
- No JavaScript-based config allowed

Example v4 configuration:

```css
@import 'tailwindcss';

@theme {
  --color-primary: oklch(50% 0.2 250);
  --color-success: oklch(60% 0.15 150);
  --color-warning: oklch(75% 0.15 80);
  --color-error: oklch(58% 0.2 25);
  --color-info: oklch(60% 0.12 240);
}
```

- Fluta's neutral tokens are defined once in `globals.css`. Store branding **overrides** `--color-primary` and `--color-accent` (plus their computed foreground colours) on the customer-page layout root only
- Store colours are injected as CSS variable values only, after validation as `#RRGGBB`; never build CSS strings from store input

## File Organization

- Components: `src/components/[feature]/ComponentName.tsx`
- Shared UI primitives (shadcn/ui): `src/components/ui/`
- Pages: `src/app/[route]/page.tsx`, grouped by experience:
  - Store workspace: `src/app/(staff)/(workspace)/...`
  - Customer pages: `src/app/(customer)/store/[slug]/...` (booking) and `src/app/(customer)/o/[token]/...` (tracking, quote, payment, receipt)
  - Fluta admin: `src/app/(staff)/(admin)/admin/...`
  - Sign-in, invitations, password reset, and the design system: `src/app/(staff)/...`
  - The `(staff)` and `(customer)` layouts each set up their own theme (see CLAUDE.md, Theme). Never add a theme provider to the root layout
- API routes: `src/app/api/v1/...`, `src/app/api/webhooks/paystack/route.ts`, `src/app/api/cron/messages/route.ts`
- Server Actions: `src/actions/[feature].ts`
- Services (business logic): `src/server/services/[feature].ts`
- Data access (all Prisma queries): `src/server/data/[feature].ts`
- Domain rules (pure functions, no I/O): `src/server/domain/` — e.g. `order-transitions.ts` (`canTransition`), `balance.ts`, `store-access.ts` (`getStoreAccess`)
- Integrations: `src/server/integrations/` — `paystack.ts`, `termii.ts`, `email.ts`, `r2.ts`
- Auth: `src/server/auth/` (Better Auth config and session helpers)
- Validation schemas (Zod): `src/schemas/[feature].ts`
- Types: `src/types/[feature].ts`
- Lib/Utils: `src/lib/[utility].ts` — `money.ts`, `phone.ts`, `time.ts`, `tokens.ts`
- Environment config: `src/lib/env.ts` (the only file that reads `process.env`)

## Module Boundaries

- **Dependency direction:** `app` / `actions` / `api` → `services` → `domain` + `data` + `integrations`. Nothing imports upward
- Only `src/server/data/` imports the Prisma client
- Only `src/server/integrations/` calls Paystack, Termii, Resend, or R2
- `src/server/domain/` is pure: no Prisma, no network, no `Date.now()` (pass `now` in), so it is easy to test
- Everything under `src/server/` starts with `import "server-only"`
- Client components never import from `src/server/`
- **One function per rule, used everywhere:**
  - Stage changes: `canTransition(from, to, context)`
  - Store permissions: `getStoreAccess(store, subscription, now)` plus role checks
  - Payment state and balance: `getBalance(order)` in `balance.ts`
  - Tracking-link validity: one helper in `tokens.ts`

## Naming

- Components: PascalCase (`OrderCard.tsx`)
- Files: Match component name or kebab-case
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase (no prefix)
- Zod schemas: camelCase ending in `Schema` (`createOrderSchema`)
- Server Actions: verb first (`createOrder`, `voidPayment`, `resendTrackingLink`)
- Prisma models and fields keep Prisma defaults (PascalCase models, camelCase fields); in raw SQL, quote them exactly (`"Store"."nextOrderNumber"`)
- UI wording follows the overview's terms exactly: "Received by store", "Quote awaiting approval", "Refund owed", "Others"
- Customer-facing text never uses internal terms like "quote required", "revision", or "fulfilment". It says what happens in plain words (for example "The store will confirm this price"). Staff screens may use the internal terms
- Never use semicolons in written text: UI copy, messages, emails, docs, comments, and reports. Use two sentences or a list instead. Code syntax is not affected

## Styling

- Tailwind CSS for all styling
- Use shadcn/ui components where applicable, with Lucide icons
- No inline styles, **except** the single `style` attribute on the customer layout root that sets validated store brand CSS variables, and the server-drawn `next/og` images (store app icon and link preview), which can only be styled inline
- Light and dark themes share the same semantic tokens; light is the default. Components never define their own colours
- Mobile-first: design for ~360px wide first, then scale up; touch targets at least 44px
- No horizontal scrolling in primary workflows; wide tables collapse to stacked cards on mobile
- Keep visuals calm: subtle borders, minimal shadows, no gradients or decorative animation

## Database

- Use Prisma ORM for all database operations
- **Use Prisma 7 (7.10 or newer), never Prisma 8.** Install with `@^7.10.0` pinned. Upgrading to Prisma 8 requires an explicit project decision
- Prisma 7 config lives in `prisma7.config.ts` (not `prisma.config.ts`, which Prisma 8 uses); it holds the direct connection URL used by the CLI. `schema.prisma` has no `url`
- The client is created once in `src/server/data/client.ts` with `@prisma/adapter-pg` and the pooled `DATABASE_URL`
- Run `prisma generate` and `prisma db seed` explicitly; Prisma 7 does not run them automatically
- Always use `prisma migrate dev` for schema changes (not `db push`)
- Run `prisma migrate status` before committing to verify migrations are in sync
- Production deployments must run `prisma migrate deploy` before the app starts
- Never edit a migration that has already been applied; write a new one
- Rules Prisma cannot express (for example the `OrderLine` type `CHECK` constraint) go in the migration SQL: create with `prisma migrate dev --create-only`, add the SQL, then apply
- **Store isolation:**
  - Every data-access function for store-owned data takes `storeId` as its first argument and includes it in every `where` clause
  - Child records are linked through composite relations (`[storeId, orderId]` → `[storeId, id]`)
  - To clear an optional composite link, set the ID field to `null`; never use `disconnect`, which also clears `storeId`
  - Never use `onDelete: SetNull` on composite relations
- **Use one transaction (`prisma.$transaction(async (tx) => …)`) for each of these:**
  - Creating an order: allocate the number from `Store.nextOrderNumber`, create the order, its lines, its version 1 revision, the first status event, and the queued link SMS
  - Changing a stage: update the order, write the status event, queue any SMS
  - Approving a revision: mark it approved, supersede the previous one, update `approvedQuoteId`, move the stage if needed
  - Voiding a payment or refund: void the record, create the replacement, write the audit event
- **Append-only history:** never update or delete `StatusEvent`, `AuditEvent`, or approved/superseded `QuoteRevision` rows. Payments and refunds change only through the void fields
- Users are never deleted, only deactivated
- Never store: raw tracking or invite tokens, full bank account numbers, or card data

## Data Fetching

- Server components fetch through `src/server/data/` functions, which enforce store scoping
- Client components use Server Actions
- Validate all inputs with Zod, on the server, even if the client also validates
- **All** text inputs are trimmed before saving. An optional one that is empty or whitespace-only is stored as `NULL`, never as an empty string
- Parse every external payload with Zod: form data, route params, query strings, Paystack webhooks, Termii responses
- No shared server-side cache for order data; static assets use browser/CDN caching only

## Money, Time, and Phone Numbers

- All money maths uses integer kobo. A line total is unit price × whole quantity (`getLineTotal` in `money.ts`), never rounded
- Format money only in `money.ts` (`formatNaira(kobo)` → "₦6,200")
- Store all timestamps in UTC; display in the **store's** time zone using helpers in `time.ts`
- Show times of day in **12-hour format** with AM/PM ("8:00 AM"); store times of day as 24-hour `HH:MM`. Convert only through `time.ts`
- Store phone numbers in E.164 (`+2348031234521`); masking and formatting live in `phone.ts`
- Pickup windows are requests; never label them as guaranteed in code or UI

## Security

- **Authorization on every request**, in this order: valid session (or valid tracking token for guest routes) → active `Membership` for the store, re-checked on every request and never cached in the session → role permits the action → `getStoreAccess` permits it
- **Tracking and invite tokens:** generate with `crypto.randomBytes(32)` (base64url), store only the SHA-256 hash, compare hashes. Resending a link always issues a new token
- **Tracking pages** send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, are `noindex`, and are excluded from analytics
- **Never log** raw tokens, full phone numbers, addresses, OTP-like codes, or Paystack secrets. Scrub them from error reports
- **Phone visibility:** full number only for owners and staff of that store; masked for customers, receipts, and Fluta admins (reveal requires a reason and an audit event)
- **Paystack:**
  - Verify the `x-paystack-signature` header on every webhook before parsing the body
  - Handle webhooks idempotently by `paystackReference`; a duplicate must never double-count a payment
  - Confirm payments only from the webhook or a server-side verify call, never from the customer's redirect
  - Initialize every transaction with the store's `subaccount` and `bearer: "subaccount"`
- **Rate limits** (PostgreSQL counts, no Redis): online bookings per phone per store and per IP across stores; daily booking-SMS cap per store; Better Auth rate limiting for sign-in, password reset, and invitation acceptance
- **Uploads:** PNG/JPEG/WebP only, max 1 MB, type checked from file bytes, Fluta-generated R2 keys, no SVG
- **Store input** (colours, description, address) is validated and rendered as plain text; no `dangerouslySetInnerHTML` anywhere
- Secrets come only from `src/lib/env.ts`, which validates them with Zod at startup; never commit `.env` files

## Notifications

- Never call Termii or Resend directly from a feature; queue a `MessageEvent` inside the same transaction as the change that triggers it
- After commit, attempt an immediate send; the cron job retries `QUEUED`/`FAILED` messages up to 3 attempts
- Claim a message with a conditional update (`QUEUED` → `SENDING`) before sending, so it is never sent twice
- Clear `MessageEvent.body` once the message is `SENT` or finally `FAILED`
- Automatic SMS only to `+234` numbers, and only within the store's daily booking-SMS cap
- Every message starts with the store name
- Staff bell: add a `Notification` with `addStaffNotification` as the **last write inside the event's own transaction**, only when the event actually changed something (never for staff's own actions, never for riders). One per event via `[storeId, type, sourceId]`
- Build lines when shown, from the order: no phone numbers or addresses in notifications

## Error Handling

- Use try/catch in Server Actions
- Actions return a typed result: `{ ok: true, message?, …data }` or `{ ok: false, message, fieldErrors? }` (for example `{ ok: true; checkoutUrl: string }`). Each action exports its result type
- `message` is a short plain-language sentence for the user; `fieldErrors` maps form field names to their messages. Never return stack traces, database errors, or a provider's own error text
- Display user-friendly error messages via toast, or beside the field for `fieldErrors`
- Domain functions return results (`{ allowed: false, reason }`) instead of throwing for expected business outcomes
- Unexpected errors are logged with context (store ID, order ID, action) but without personal data or tokens
- Integration failures (Paystack, Termii, R2) never leave the database half-updated: write state first in a transaction, call the provider after, and record the outcome

## Testing

- **Vitest unit tests** for every pure domain function: `canTransition` (every from/to pair, both order types, both roles), `getStoreAccess`, `getBalance`, money rounding, phone masking, token validity and expiry
- **PostgreSQL integration tests** (real database, two seeded stores) — tenant isolation is top priority. A Store A user must not be able to:
  - read, update, or cancel a Store B order
  - see a Store B customer
  - add a Store B service to an order or use a Store B service area
  - create a payment or refund against a Store B order
  - and a Store A tracking link must never return Store B data
- Integration tests also cover: concurrent order creation never duplicates a number; duplicate Paystack webhooks count once; a voided payment no longer affects the balance
- **Playwright journeys** (few, critical): guest booking → quote approval → payment; staff counter order → completed; returning customer "same as last time"
- Every bug fix comes with a test that would have caught it

## CI

Every feature must pass these before `/feature complete` commits it, in order:

1. `npm run lint` (ESLint, no warnings)
2. `npm run typecheck` (`tsc --noEmit`)
3. `prisma validate` and a check that no schema change is missing a migration
4. `npm run test:unit`, then `npm run test:integration` (run in this order, so a failure shows which side broke)
5. Playwright journeys on `staging` before a pull request to `main`

`/feature complete` runs these before committing; GitHub Actions can also run them on push to `staging` and on pull requests to `main` (optional).

## Git Workflow

- One branch per feature or fix: `feat/guest-booking-flow`, `fix/refund-owed-calculation`
- Branch flow: **feature branch → `staging` → `main`**
  - Every `feat/` or `fix/` branch starts from an up-to-date `staging`
  - `/feature complete` merges it into `staging` locally, pushes `staging`, and deletes the branch
  - `main` is production. It changes only through a pull request from `staging` to `main`, opened by the project owner when a set of changes is ready for production
- GitHub protection:
  - `main`: pull requests required, no direct pushes, no force-pushes, no deletion
  - `staging`: no force-pushes and no deletion; direct pushes allowed so `/feature complete` can push its merge
- Deployment: Railway, one project with two environments. `staging` deploys automatically from the `staging` branch; `production` deploys from `main`. Every deploy runs `prisma migrate deploy` before the app starts, and Railway checks `/api/health`
- Small, focused feature branches
- Schema changes are called out in the commit message with the migration name

## Review Checklist

Every feature is checked against this list before completing:

- [ ] Every store-owned query is scoped by `storeId`
- [ ] Access is checked server-side (`Membership` + role + `getStoreAccess`)
- [ ] Multi-step writes are inside one transaction
- [ ] Money is integer kobo; no floats
- [ ] Stage changes go through `canTransition`
- [ ] No raw tokens, full phones, or secrets in logs, URLs (other than the tracking link itself), or responses
- [ ] Inputs parsed with Zod
- [ ] Tests added or updated, including isolation tests for new store-owned data

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible
- No `console.log` in committed code; use the logger
- No new dependencies without a stated reason in the PR
- Prefer clear names over comments; comment only the _why_ of non-obvious rules
