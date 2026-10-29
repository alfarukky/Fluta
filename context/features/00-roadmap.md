# Fluta Feature Roadmap

Fluta is built one feature at a time. Each feature has its own spec in `@context/features/`, follows `@context/ai-interactions.md`, and is finished (checks passing, merged) before the next starts. Order matters: later features depend on earlier ones.

## Phase A — Foundation ✅

1. **Foundation & design system** — Tailwind v4 tokens, light and dark themes, shadcn/ui, `Logo`, `/design-system` showcase (dev only) ✅
2. **Database & seed data** — `env.ts`, Prisma 7.10, schema, migrations, FreshFold seed, test database ✅
3. **Authentication & store access** — sign-in, sessions, membership checks, `getStoreAccess` ✅
4. **Workspace shell** — sidebar, top bar, mobile navigation, user menu, getting-started overview, `time.ts` ✅
5. **Store settings & branding** — store profile, booking link and QR code, colours, logo, `phone.ts` ✅

## Phase B — Store setup ✅

6. **Service catalogue** — services, pricing types, quote-required flag, `money.ts` ✅
7. **Fulfilment settings** — drop-off/pickup toggles, service areas and charges, schedule, closed dates ✅
8. **Staff management** — invitations, roles, deactivation with session revocation ✅

## Phase C — Orders (staff side) ✅

9. **Staff order entry** — new order form, lines, Others adjustments, order numbers, version 1 revision, per-kg kobo rounding ✅
10. **Orders list & order detail** ✅
11. **Order stages** — `canTransition`, stage actions, timeline, cancel, step back ✅
12. **Quotes & revisions** — weighing, priced quotes, revisions, approvals ✅

## Phase D — Customers

13. **Customer booking flow** — six-step booking on `/store/[slug]`, booking limits, home-screen app per store, branded link previews ✅
13b. **Booking improvements** — quantity stepper, customer's "Anything else?" note, address guidance ✅
    - Fix after 13b: staff set the unit price of quote-required lines when pricing (`context/fixes/quote-line-unit-price.md`) ✅
14. **Guest tracking & approvals** — tracking link, quote approval, pickup-window acceptance, expiry, staff confirming or proposing pickup windows ✅
14b. **Deliveries view and Rider role** — a simple phone-friendly list for the store's own riders: today's pickups and deliveries sorted by time window, with Call, address, area, and window, and one big button for the next step (Mark picked up, Out for delivery, Mark delivered), reusing Feature 11's `canTransition`. Adds a **Rider** role (schema change, Ask First): owners choose Staff or Rider when inviting (updates Feature 08). Riders can only open the Deliveries view and use those three moves, and see no prices, payments, notes, or order history. Enforced on the server for every page and action. Owners and staff can use the Deliveries view too ✅
15. **Notifications** — SMS outbox, Termii, retry job, daily cap, email copies, manual WhatsApp, sweeping old booking IP hashes, anti-fraud wording ("Real links always start with {domain}") and one registered sender name ✅
15b. **Location and default delivery fee** — "Use my current location" on booking with "Open in Maps" for staff and riders, optional default delivery fee with "My area isn't listed", `isPickupAvailable` accepts a default fee, "Outside our service areas" badge ✅
15c. **Brand logo and sign-in page** — Fluta's real logo (SVG versions) everywhere Fluta's brand appears, polished sign-in page with a slight, calm animation ✅

## Phase E — Money

16. **Store-collected payments & balance** — record payments, `getBalance`, payment badges, voids ✅
16b. **Staging environment and branch flow** — Railway staging (own database, storage, secrets), feature → `staging` → `main` (production), `DATABASE_BRANCH=staging`, noindex and staging banner, Paystack test webhooks to staging. Done before Feature 17 Phase 2
17. **Paystack connection & online payments** — bank connection flow, checkout, webhooks, optional Fluta fee (default 0%), anti-fraud rules (online payment only on Paystack's page, never an account number to transfer to, warning line on the payment step)
18. **Refunds**
19. **Receipts**

## Phase F — Insight & convenience

20. **Owner dashboard** — figures, attention required, orders by status, recent orders (attention list includes out-of-area orders from 15b)
21. **Customers page & Repeat order**
22. **Returning-customer conveniences** — last order and details remembered on the phone

## Phase G — Fluta admin & hardening

23. **Fluta admin: stores & subscriptions** — onboarding, store status, invoices, SMS usage
24. **Support lookup & audit log**
25. **Launch hardening** — rate-limit review, security headers, Playwright journeys, Paystack test checklist, Neon production safety (no auto-delete or expiry, protected branch, restore window confirmed), logos served from Fluta's own domain with `X-Content-Type-Options: nosniff`, host request logs checked for tracking tokens, DMARC record for the email domain, optional look-alike domain registration, privacy notice wording for `/privacy` (provided by the project owner, reviewed for Nigeria's data protection law)
