# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev`: dev server at http://localhost:3000 (Turbopack)
- `npm run build`: production build; also runs the TypeScript check
- `npm run lint`: ESLint over the whole repo (flat config in `eslint.config.mjs`); lint one file with `npx eslint <path>`
- `npm run typecheck`: type-check without building (`tsc --noEmit`)
- `npm run test:unit`: the unit project only (jsdom, fast); `npm run test:watch` for watch mode; run one file with `npx vitest run <path>`
- `npm run test:integration`: PostgreSQL integration tests on the Neon `test` branch (slower). While building, run only related files, e.g. `npm run test:integration -- path/to/file.test.ts`
- `npm test`: runs `test:unit`, then `test:integration` (integration is skipped if unit tests fail)
- `npm run db:seed`: load the FreshFold Laundry sample data

Vitest has two projects (`vitest.config.mts`). **unit**: React Testing Library in jsdom, colocated `src/**/*.test.{ts,tsx}` and `prisma/**/*.test.ts`. **integration**: `*.integration.test.ts` against real PostgreSQL on the Neon `test` branch. Its global setup (`src/test/integration/`) loads `.env.test` only, refuses unless `DATABASE_BRANCH="test"` and the host differs from `.env.local`, then runs `prisma migrate deploy` and the seed. Integration tests get a client from `createTestPrisma()`; Vitest aliases `server-only` to its empty build, so tests can also call server modules (`getAuth()`, `authorizeStoreMember`) against the test branch. `src/test/integration/auth.ts` signs in through Better Auth's HTTP handler. Locally, if workers time out starting (low memory), run with `--maxWorkers=2`. `@/*` imports resolve through `resolve.tsconfigPaths`. Vitest can't render `async` Server Components, so test those end-to-end instead.

Database (Prisma 7.10+, never Prisma 8; installed with @^7.10.0 pinned; config in prisma7.config.ts, not prisma.config.ts):

npx prisma migrate dev --name <name> — create and apply a migration (never db push)
npx prisma migrate dev --create-only --name <name> — create a migration to hand-edit (for CHECK constraints)
npx prisma migrate status — confirm migrations are in sync before committing
npx prisma generate — regenerate the client after schema changes (not automatic in Prisma 7)
npx prisma db seed — run the seed (not automatic in Prisma 7; npm run db:seed calls this)

If a script above does not exist yet in package.json, say so and ask before adding it.

- **Env:** All environment variables are listed in `.env.example`; read them only through `src/lib/env.ts`.
- **Client:** `getPrisma()` from `src/server/data/client.ts` (created on first use so `next build` needs no secrets) (generated client imported from `@/generated/prisma/client`, gitignored). Every `PrismaPg` adapter takes `pgPoolConfig(url)` from `src/lib/database-url.ts`, which applies `connect_timeout` (pg ignores it in the URL) and lengthens Node's per-address connect attempt (the 250 ms default fails on slow links to Neon).
- **Seed:** `prisma/seed.ts` → `prisma/seed/` (one spec per store, `order-builder.ts` mirrors the order-creation transaction). It runs under `tsx --conditions=react-server` so it can import `server-only` modules. It deletes and recreates only the FreshFold and CleanWave stores and the seeded users (`prisma/seed/users.ts`, created first through `createUserWithPassword`, all with `SEED_USER_PASSWORD`), then fails if any actor ID doesn't match a user. The seed data and the clear step use long transaction timeouts, because Neon round trips are slow from here.

## Stack and architecture

- **Next.js 16 (App Router) + React 19 + TypeScript (strict).** Routes live in `src/app/`. There is no `pages/` directory. Next.js 16 differs from older versions, so check `node_modules/next/dist/docs/` (`01-app/` covers the App Router) before using framework APIs.
- **Route type helpers:** layouts and pages use Next's globally generated types, such as `LayoutProps<"/">` in `src/app/layout.tsx`. They are generated into `.next/types` / `.next/dev/types` (both included in `tsconfig.json`), so run `dev` or `build` once if they appear missing.
- **Import alias:** `@/*` maps to `src/*`.
- **Styling:** Tailwind CSS v4 through `@tailwindcss/postcss`. There is no `tailwind.config.*`. All design tokens live in `src/app/globals.css`:
  - Semantic colours (`background`, `card`, `muted`, `primary`, `accent`, `success`, `warning`, `error`, `info`, …) are CSS variables on `:root`, redefined under `.dark`, and exposed via `@theme inline`. Components use only these (`bg-primary`, `text-muted-foreground`), never raw colours or `dark:` overrides.
  - Typography uses `type-*` utilities (`type-display`, `type-h1`–`type-h3`, `type-body`, `type-body-sm`, `type-label`, `type-caption`). They are named `type-*`, not `text-*`, so `cn()` class merging doesn't drop them in favour of text colours.
  - Responsive spacing tokens: `px-page`, `py-section`, `p-card`, `gap-form`, `gap-grid`, `gap-component`, plus the `page-container` utility. Breakpoints are mobile-first: base (small mobile), `xs` 400px, `md` 768px (tablet), `lg` 1024px (desktop).
  - Radius `rounded-sm|md|lg|xl|full`; surfaces are separated by borders, and shadows are only for elevated layers.
- **Theme:** `next-themes` (`src/components/theme/`) toggles the `.dark` class on `<html>`. Light is the default and the system preference is ignored.
- **UI components:** shadcn/ui (Radix base, `components.json`) in `src/components/ui/`, add more with `npx shadcn@latest add <name>`. Variants are customised: Button `primary|secondary|outline|ghost|destructive|link` (44px default height), Badge `neutral|success|warning|error|info` (optional decorative `dot`). Icons come only from `lucide-react`. Toasts use `sonner` (`<Toaster />` is in the root layout).
- **Internal showcase:** `/design-system` (`src/app/design-system/`, sections in `src/components/design-system/`) demonstrates every token and component using static FreshFold Laundry sample data. Check new UI there in both themes at ~360px and desktop widths.
  - **Development-only:** the page calls `notFound()` unless `isDevelopment()` (`src/lib/env.ts`, the only module that reads `process.env`) is true, so production serves a 404. Keep the guard in the page itself, not a layout: Next renders layouts and pages in parallel, so a layout-level `notFound()` still serializes the page into the 404 response. Showcase client components take their sample text as props from the server page so none of it ends up in client bundles.
- **Auth:** Better Auth (`src/server/auth/auth.ts`, lazy `getAuth()`), email/password with database sessions. No endpoint can create a user; users come only from `createUserWithPassword` (`src/server/data/users.ts`), memberships only from `createMembership`. Sign-in posts to `/api/auth/sign-in/email` from the client (rate limits only apply to HTTP requests, not `auth.api` calls). Pages and actions call `requireStoreMember({ role? })` / `requireFlutaAdmin()` from `src/server/auth/session.ts` themselves, not just in layouts; `getStoreAccess` lives in `src/server/domain/store-access.ts`.
- **Home page:** `src/app/page.tsx` is a placeholder (logo, tagline, and a development-only link to `/design-system`).
- **Store workspace:** shell and workspace UI live in `src/components/workspace/` (`AppShell`, `Sidebar`, `MobileNav`, `UserMenu`, `PageHeader`). Navigation is defined once in `nav-items.ts`; pages still call `requireStoreMember()` themselves.
- Static assets go in `public/`.

## Note

Ensure you do not reference Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com> or any reference to claude in my git commit messages.
