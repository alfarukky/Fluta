# Feature 02 — Database & Seed Data

## Overview

Sets up PostgreSQL on **Neon** with **Prisma 7**, applies the full schema from the project overview, and seeds realistic sample data. No UI. Every later feature builds on this.

## Requirements

### Environment

- `src/lib/env.ts`: reads and validates environment variables with Zod (starting with `DATABASE_URL`); the only file in the app that reads `process.env`. Later features add their variables here
- The app fails fast at startup with a clear message if a required variable is missing
- `.env.example` lists every variable with placeholder values and comments; real values live in `.env.local` (never committed)

### Neon

- One Neon project with three branches:
  - `development` — daily work; URLs in `.env.local`
  - `test` — integration tests; URLs in `.env.test`
  - `production` — live; URLs only in the host's environment settings
- Each environment has two connection strings:
  - `DATABASE_URL` — **pooled** (`-pooler` in the host), used by the app at runtime
  - `DIRECT_URL` — **direct** (no `-pooler`), used only by the Prisma CLI for migrations
- Add `connect_timeout=15` to both URLs so a Neon branch waking from idle does not cause timeout errors

### Prisma 7

- Install Prisma 7.10 or newer, never 8: `npm install @prisma/client@^7.10.0 @prisma/adapter-pg@^7.10.0` and `npm install -D prisma@^7.10.0`. Also install `dotenv` and `tsx`
- Read the full Prisma 7 upgrade guide before starting and follow its requirements (generator, ESM/tsconfig, driver adapters, config)
- `prisma7.config.ts` at the project root (the version-specific name Prisma 7.10+ prefers; do **not** name it `prisma.config.ts`, which Prisma 8 uses):
  - imports `defineConfig` from `prisma/config` (not `@prisma/prisma7/config`, which is only for running Prisma 7 and 8 side by side)
  - loads environment variables explicitly with dotenv from `.env.local` (Prisma 7 does not load them, and dotenv reads `.env` by default)
  - `datasource.url` set to `DIRECT_URL`
  - `migrations.path` = `prisma/migrations`; `migrations.seed` = `tsx prisma/seed.ts`
- `prisma/schema.prisma`: generator `prisma-client` with output `src/generated/prisma`; datasource has `provider` only (no `url`)
- Generated client folder added to `.gitignore`
- One client instance in `src/server/data/client.ts` (with `import "server-only"`), created with `PrismaPg` from `@prisma/adapter-pg` using the **pooled** `DATABASE_URL` from `env.ts`. Do not use Neon's HTTP-only adapter (Fluta relies on interactive transactions)
- Reuse the client across hot reloads in development (global singleton)

### Schema and migrations

- `prisma/schema.prisma` copied from the Data Model section of `@context/project-overview.md`
  - Better Auth tables are **not** added here (Feature 03)
- First migration: `npx prisma migrate dev --name init`
- Second migration: `npx prisma migrate dev --create-only --name order_line_type_check`, then add the `OrderLine` CHECK constraint described in the schema comment, then apply it
- Run `npx prisma generate` after migrations (Prisma 7 no longer runs it automatically)

### Seed data

- `prisma/seed.ts`, run by `npm run db:seed` (which calls `prisma db seed`; Prisma 7 no longer seeds automatically)
- The seed clears its own data first, so it can run repeatedly
- **FreshFold Laundry**: prefix `FF`, time zone `Africa/Lagos`, brand colour `#173C32`, address, phone, email
- Services from the overview sample (Shirt, Trousers, Dress, Bedding, Laundry by weight with quote required)
- Service areas (one fixed charge, one quote required), active days, hours, one closed date
- 8–10 customers with Nigerian names and fictional numbers/addresses
- 10–15 orders spread across every stage, with version 1 revisions, a few payments (online and store-collected), one refund-owed case, one cancelled order; order numbers allocated from `nextOrderNumber`
- A second store, **CleanWave Laundry** (prefix `CW`), with a few services, customers, and orders, used by isolation tests
- A subscription for each store
- The seed refuses to run when pointed at the `production` branch

### Integration tests

- Vitest configured for integration tests if Feature 01 did not already set it up
- Integration tests load `.env.test` (the Neon `test` branch); a helper applies migrations, resets, and seeds before the suite
- Tests never run against `development` or `production`

## Not in this feature

- Users and passwords (Feature 03 seeds them through Better Auth)
- Data-access functions beyond the client (each feature adds its own)
- Production deployment and running `prisma migrate deploy` on the host

## Done when

- `npx prisma validate` passes; `npx prisma migrate status` reports in sync on `development`
- Seeding twice in a row works
- Integration tests confirm the CHECK constraint rejects an adjustment line with a quantity, and the composite keys reject an order line pointing at the other store's order
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass

## References

- Initial data models: @context/project-overview.md
- Database standards: @context/coding-standards.md
- Previous feature: @context/features/01-foundation-design-system-spec.md
- Prisma 7 upgrade guide (read fully before starting): https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- Prisma 7 docs: https://www.prisma.io/docs/orm/v7 (append `.md` to any docs page URL for a markdown version)
- Neon + Prisma: https://neon.com/docs/guides/prisma

## Notes

- **Use Prisma 7 for this project.** Prisma 8 is the current release, but it introduces a substantially different contract, client, and migration workflow. We are deliberately standardizing on Prisma 7 for the MVP so the implementation stays stable and aligned with this specification, and because Better Auth integrates through its standard Prisma adapter. Do not upgrade to Prisma 8 unless the project explicitly decides to migrate.
- Always install with `@^7.10.0` pinned, and keep the config in `prisma7.config.ts`. If documentation or examples mention `@prisma/orm-postgres`, `contract.prisma`, `prisma migration plan`, or queries like `db.orm.public.User`, they are Prisma 8; stop and use the Prisma 7 docs instead.
- We work on the Neon `development` branch and deploy to `production`. ALWAYS create migrations with `prisma migrate dev`; never use `db push` unless explicitly told to.
- The app always uses the pooled URL; the Prisma CLI always uses the direct URL.
- Run `prisma generate` and `prisma db seed` explicitly; Prisma 7 does not run them automatically.
