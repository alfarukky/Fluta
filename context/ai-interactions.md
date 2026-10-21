# AI Interaction Guidelines

How AI assistants (Claude Code, Cursor, ChatGPT) work on Fluta. Read these files before every task:

- @context/project-overview.md — what Fluta is and what the MVP includes
- @context/coding-standards.md — how the code is written
- @context/current-feature.md — the task you are working on now

If these files conflict, stop and point out the conflict instead of choosing one.

## Communication

- Be concise and direct
- Never use semicolons in written text: UI copy, messages, emails, docs, comments, and reports. Use two sentences or a list instead. Code syntax is not affected
- Explain non-obvious decisions briefly
- Ask before large refactors or architectural changes
- Don't add features not in the project overview
- Never delete files without clarification
- Never edit @context/project-overview.md or @context/coding-standards.md unless asked; suggest the change instead

## Scope

- Build only what @context/project-overview.md defines for the MVP
- Anything under **Later** or **Out of scope** is not built, even if it seems helpful (for example customer accounts, rider tracking, automated WhatsApp, row-level security)
- Items marked **(Open)** are undecided; ask instead of inventing an answer
- Items marked **(Assumption)** may be built as written, but mention it when the task relies on one

## Tools (MCP)

Use these MCP servers to check facts instead of guessing. Each has one job:

- **Context7 — current library documentation.** Look up Better Auth, Next.js, shadcn/ui, Zod, Tailwind v4, and other libraries before writing code that depends on their APIs
  - For Prisma, always request **Prisma 7** docs, or use the v7 links in the feature spec. Context7 may return Prisma 8 docs by default; do not follow them
- **Next.js DevTools — the running dev server.** Use it to read actual runtime and build errors, check routes, and diagnose problems instead of guessing from code. Check it after implementing and before reporting a task as done
- **Neon — the database.**
  - Allowed: inspect tables and data, run read-only SQL checks, confirm migrations and seed results, manage the `test` branch, and try a migration on a temporary branch before applying it
  - Ask first: any write or destructive action on the `development` branch (dropping, resetting, deleting data or branches)
  - **Never touch the `production` branch**, not even to read data
  - Migrations are still created with `npx prisma migrate dev`; never use Neon tools to change the schema directly
- **Playwright — a real browser.** Use it to check your own UI work: pages at ~360px and desktop width, light and dark themes, main flows clicked through, no console errors
  - This is for checking during implementation. It does not replace the Playwright test files required by @context/coding-standards.md

If an MCP server is unavailable, say so and continue with the normal checks; do not skip verification silently.

## Ask First

Always ask before:

- Changing `schema.prisma` (state the exact change and the migration name)
- Adding a new dependency (state why an existing one won't do)
- Touching security-sensitive code: authentication, `getStoreAccess`, membership checks, tracking/invite tokens, rate limits, or upload validation
- Touching money code: Paystack integration, webhooks, balance calculation, payments, refunds, or voids
- Changing `canTransition` or any order-stage rule
- Changing store-scoping in `src/server/data/`
- Any write or destructive action through the Neon MCP on the `development` branch

## Never

- Never create `tailwind.config.*` (Tailwind v4 is configured in CSS)
- Never install Prisma 8 or follow Prisma 8 docs; Prisma is pinned to `@^7.10.0` with config in `prisma7.config.ts`
- Never use `prisma db push`, and never edit an applied migration
- Never call Prisma outside `src/server/data/`
- Never access the Neon `production` branch
- Never weaken a security rule, test, validation, or type to make code pass
- Never use real customer data; use the FreshFold Laundry sample data
- Never use live Paystack or Termii keys, and never paste secrets into code, commits, or chat
- Never log or print raw tokens, full phone numbers, or addresses, even while debugging

## Workflow

This is the common workflow that we will use for every single feature/fix:

1. **Document** - Document the feature in @context/current-feature.md: goal, which overview sections it implements, and any schema changes
2. **Branch** - Create a new branch for the feature, fix, etc.
3. **Implement** - Implement the feature/fix described in @context/current-feature.md. Check library APIs with Context7 before using them
4. **Test** - Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`, and fix any errors. Add or update tests as required by @context/coding-standards.md (isolation tests for any new store-owned data). Then verify:
   - **Next.js DevTools:** no runtime or build errors
   - **Playwright MCP:** the feature works at ~360px and desktop, in light and dark themes
   - **Neon MCP:** database changes and seed data are as expected (when the feature touches the database)
   - Any **Verify with** steps listed in the feature spec
5. **Iterate** - Iterate and change things if needed
6. **Commit** - Only after all checks pass and everything works
7. **Merge** - Merge to main
8. **Delete Branch** - Delete branch after merge
9. **Review** - Review AI-generated code periodically and on demand
10. **Complete** - Mark as completed in @context/current-feature.md and add to history

Do NOT commit without permission and until all checks pass. If a check fails, fix the issues first. The `/feature` commands follow this workflow: `load` = step 1, `start` = steps 2–3, `test` and `review` = step 4, `complete` = steps 6–8 and 10.

## Branching

We will create a new branch for every feature/fix, named as in @context/coding-standards.md: **feat/[feature]**, **fix/[fix]**, **chore/[task]** (for example `feat/guest-booking-flow`). Ask to delete the branch once merged (running `/feature complete` counts as permission).

## Commits

- Ask before committing (don't auto-commit); running `/feature complete` counts as permission
- Use conventional commit messages (feat:, fix:, chore:, test:, refactor:, docs:)
- Keep commits focused (one feature/fix per commit)
- Commits that include a schema change say so in the message and include the migration
- Never put "Generated With Claude" in the commit messages

## When Stuck

- If something isn't working after 2-3 attempts, stop and explain the issue
- Don't keep trying random fixes
- Check Next.js DevTools for the actual error and Context7 for the current API before guessing
- Ask for clarification if requirements are unclear
- If a test fails, fix the code, not the test, unless the test itself is wrong; then explain why

## Code Changes

- Make minimal changes to accomplish the task
- Don't refactor unrelated code unless asked
- Don't add "nice to have" features
- Preserve existing patterns in the codebase
- Reuse the single-purpose functions (`canTransition`, `getStoreAccess`, `getBalance`, money/phone/time helpers) instead of reimplementing their logic

## Code Review

Review AI-generated code periodically, especially for:

- **Store isolation:** every store-owned query scoped by `storeId`; no cross-store links possible
- **Security:** access checked server-side (membership + role + `getStoreAccess`); inputs parsed with Zod; no tokens or personal data in logs or URLs
- **Money:** integer kobo only; balance from `getBalance`; payments confirmed only by webhook or server-side verify
- **Consistency:** multi-step writes inside one transaction; stage changes through `canTransition`; messages queued through the outbox
- **Performance:** unnecessary re-renders, N+1 queries
- **Logic errors:** edge cases (cancelled orders, voided payments, pending revisions, paused stores)
- **Patterns:** matches the existing codebase and @context/coding-standards.md
