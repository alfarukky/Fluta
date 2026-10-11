# Fluta

Fluta is a subscription tool for independent laundry stores. Owners and staff manage orders, services, pickup and delivery, quotes, payments and staff in one place. Each store also gets a branded booking and order-tracking page for its customers, who never need an account.

It is a mobile-first web app built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Prisma 7 on Neon PostgreSQL, and Better Auth.

## Getting started

You need Node.js 22 and access to the Neon project (a `development` branch for the app and a `test` branch for integration tests).

1. Install dependencies. This also generates the Prisma client.

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in every value. The comments in `.env.example` explain each one. For integration tests, make a second copy named `.env.test` that points at the Neon `test` branch and the `fluta-test` bucket.

3. Apply the migrations and load the sample data (the FreshFold Laundry and CleanWave stores and their users, all signing in with `SEED_USER_PASSWORD`).

   ```bash
   npx prisma migrate dev
   npm run db:seed
   ```

4. Start the dev server at http://localhost:3000.

   ```bash
   npm run dev
   ```

The app checks its environment at startup and exits with a clear message if a variable is missing or invalid.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build, including the TypeScript check |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint over the whole repo |
| `npm run typecheck` | TypeScript check without building |
| `npm run test:unit` | Unit tests (jsdom, fast) |
| `npm run test:integration` | Integration tests against the Neon `test` branch |
| `npm test` | Unit tests, then integration tests |
| `npm run db:seed` | Reset the sample stores and users |

## Project layout

- `src/app/`: routes (store workspace, sign-in and invitations, API routes)
- `src/actions/`: Server Actions
- `src/server/`: services, data access (the only place that uses Prisma), domain rules, integrations and auth
- `src/components/`: UI, with shadcn/ui primitives in `src/components/ui/`
- `src/lib/`: shared helpers (money, phone numbers, time, tokens, environment)
- `prisma/`: schema, migrations and seed

In development, `/design-system` shows every design token and component in both themes.
