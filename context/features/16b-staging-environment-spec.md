# Feature 16b — Staging Environment and Branch Flow

## Overview

Fluta gets a **staging** site on Railway: a stable, public pre-production copy for testing and presenting progress, with its own database, storage, and secrets. The Git workflow changes so every feature goes **feature branch → `staging` → `main`**, where `main` becomes the production branch. Staging also gives Paystack's test webhooks a permanent address, replacing the tunnel for most testing.

This is done before Feature 17 Phase 2.

## Requirements

### 0. A clean, synced starting point (before anything else)

1. On `main`, check `git status` and list every uncommitted file
2. Review uncommitted `context/` files (and any others) for secrets before committing. No `.env` file, key, or password may be committed
3. Commit them in one commit, for example `docs: update context files`, after the project owner approves the list
4. Fetch from GitHub and compare: local `main` and `origin/main` must point to the same commit. If GitHub has commits that local doesn't, pull them first. If local has commits GitHub doesn't, push them
5. Confirm `git status` is clean and `main` is in sync, and report the commit both now share
6. Only then create `staging` from that commit (section 1) and push it, so `main` and `staging` start identical

### 1. The branch flow

- **`staging`** is created from the current `main` and becomes the branch all work starts from and merges into
- **Every feature and fix** works the same way as now, with one change: the branch is created **from `staging`** and merged **into `staging`**:
  1. `/feature start` creates `feat/...` (or `fix/...`) from an up-to-date `staging`
  2. Work, commit, and run the usual checks
  3. `/feature complete` merges into `staging` locally, pushes `staging`, and deletes the branch
- **`main` is production.** It changes only through a pull request from `staging` to `main`, opened by the project owner when a set of changes is ready for production
- **GitHub protection:**
  - `main`: pull requests required, no direct pushes, no force-pushes, no deletion
  - `staging`: no force-pushes and no deletion. Direct pushes stay allowed, so `/feature complete` can push its local merge
- Branch prefixes stay `feat/` and `fix/`

### 2. Update the workflow files

So every future session follows the new flow:

- `.claude/commands/feature/start.md`: branch from an up-to-date `staging`, never from `main`
- `.claude/commands/feature/complete.md`: merge into `staging`, push `staging`, delete the branch. Never merge into or push `main`
- `CLAUDE.md`: the branch flow and that `main` is production
- `context/coding-standards.md` (Git and deployment): the flow, the protection rules, and that `main` changes only by pull request
- `context/ai-interactions.md`: **Never** push to `main` or merge into it. **Never** run anything against the staging or production databases except through deployment
- `context/project-overview.md` (Development Workflow): replace "merged locally into `main`" with the new flow, and in the technology table set the app host to "Railway (staging and production environments)"

### 3. Railway project

- One Railway project with two environments: **`staging`** (deploys automatically from the `staging` branch) and **`production`** (deploys from `main`, set up now but not opened to real users until launch, Feature 25)
- Every deploy runs `prisma migrate deploy` before the app starts. A failed migration stops the deploy, and the previous version keeps running
- A health check route, `/api/health`, returning `200` with no data, used by Railway to confirm each deploy started
- The Node version is pinned to the project's version
- Staging uses Railway's provided address (for example `fluta-staging.up.railway.app`) until a custom domain is chosen

### 4. `DATABASE_BRANCH` gains `staging` (code change, Ask First)

In `src/lib/env.ts`, `DATABASE_BRANCH` accepts `development`, `test`, `staging`, and `production`. Staging behaves like production, with test-mode payments:

| Rule | development | staging | production |
| --- | --- | --- | --- |
| `BETTER_AUTH_URL` must be `https` and not localhost | No | Yes | Yes |
| Paystack key | test only | **test only** | live only |
| Paystack and Termii variables may be unset | Yes | Yes | No |
| The seed may run | Yes | Yes, only with `ALLOW_STAGING_SEED=true` | Never |

- When Termii isn't configured on staging, the development provider marks messages as sent without sending them, so demos never cost SMS. Email through Resend stays real
- Unit tests cover every rule in the table

### 5. Staging's own services

Nothing is shared with development or production:

- **Database:** a Neon branch named `staging`. Migrated by deploys, seeded once with the demo stores (FreshFold and CleanWave) using a staging-only `SEED_USER_PASSWORD`
- **Logo storage:** an R2 bucket `fluta-staging`, with its own public address in `R2_PUBLIC_URL`
- **Secrets:** its own `BETTER_AUTH_SECRET`, `BOOKING_IP_SECRET`, and `CRON_SECRET`, each generated fresh
- **Paystack:** the test secret key, `PAYSTACK_MODE="test"`. The Paystack dashboard's **Test Webhook URL** is set to `https://{staging address}/api/webhooks/paystack`. Local tunnel testing (plan section 11) is still possible, but the Test Webhook URL is set back to staging afterwards
- **Email:** Resend with the verified domain, sending from a clearly marked staging address (for example "Fluta Staging")
- **Scheduled job:** a Railway cron service calls `/api/cron/messages` every 5 minutes with `CRON_SECRET`

### 6. Staging must never be mistaken for the real thing

- **Not in search engines:** every staging response sends `X-Robots-Tag: noindex, nofollow`, including store booking pages (which production allows to be listed). Decided by `DATABASE_BRANCH=staging`, not by hand
- **A visible banner** across the workspace and customer pages: "Staging: test data only. Payments are in test mode." Small, but impossible to miss
- Email subjects from staging start with "[Staging]"

### 7. Variables

`.env.example` gains `ALLOW_STAGING_SEED`, and its comment lists every variable each environment needs. Staging's values are set only in Railway's staging environment, never in a file.

## Not in this feature

- Opening production to real users, live Paystack keys, custom domains, and the launch checklist (Feature 25)
- Preview deployments per feature branch
- Automatic tests in CI (optional, later)

## Done when

- All context files are committed, the working tree is clean, and local `main`, `origin/main`, and the new `staging` all start from the same commit
- `staging` exists, is protected against force-pushes and deletion, and `main` requires pull requests
- `/feature start` branches from `staging`, and `/feature complete` merges into and pushes `staging`, verified with a small test change
- All workflow documents describe the new flow
- Railway's staging environment deploys from `staging`, runs migrations first, and passes the health check
- The staging site opens at its Railway address, with the banner and the noindex header on every page, including booking pages
- The demo stores are seeded on the staging database, and signing in, booking, and a store-collected payment work there
- A Paystack test payment's webhook reaches staging without a tunnel, with a valid signature
- The scheduled job runs every 5 minutes on staging
- Unit tests for the `DATABASE_BRANCH` rules pass, including staging refusing a live Paystack key and the seed refusing to run without `ALLOW_STAGING_SEED`
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## References

- @context/coding-standards.md (Git, environments, Security)
- @context/ai-interactions.md
- @context/docs/paystack-integration-plan.md (sections 5.4, 10, 11)
- @context/features/02-database-spec.md (Neon branches, seed)
- `.claude/commands/feature/start.md` and `complete.md`
