---
description: Clean up Fluta project housekeeping (add "run" to fix items)
argument-hint: run|check
---

Review the project for cleanup tasks. Read @context/coding-standards.md and @context/ai-interactions.md first, because most checks below come from their rules.

## Records and context files

1. History in @context/current-feature.md is in order from oldest to newest, and every completed feature has an entry
2. The roadmap (`context/features/00-roadmap.md`) marks as done (✅) exactly the features the history says are completed
3. The schema in @context/project-overview.md matches `prisma/schema.prisma`: same models, fields, and unique rules. List every difference in either direction
4. CLAUDE.md commands match the scripts in `package.json`
5. `npx prisma validate` passes and `npx prisma migrate status` reports in sync on `development`

## Environment

6. `.env.example` lists every variable that `src/lib/env.ts` reads, plus `SEED_USER_PASSWORD`, with empty values
7. `.env.local` and `.env.test` contain every variable from `.env.example`. Report only the variable names, never their values
8. `.env.test` points at the Neon `test` branch and the `fluta-test` bucket, never development or production
9. No `.env*` file other than `.env.example` is tracked by git
10. Nothing outside `src/lib/env.ts` reads `process.env`

## Code rules

11. No `console.log` in `src/` (use the logger)
12. No unused imports, variables, or exports (run `npm run lint` and check exports nothing imports)
13. No `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` that may be stale. Report each with its reason, if any
14. Prisma is only imported in `src/server/data/`, and every file in `src/server/` starts with `import "server-only"`
15. No booking links, order numbers, or Naira amounts built by hand: they must use `getBookingUrl`, `formatOrderNumber`, and `formatNaira`. No times of day shown without the `time.ts` helpers
16. No hard-coded colours outside the theme tokens, and no inline `style` attributes except those built by `getBrandTheme()`
17. No logging of raw tokens, full phone numbers, addresses, or secrets
18. No semicolons in text shown on Fluta's UI: page copy, labels, placeholders, form and error messages, toasts, and page titles and descriptions. Ignore semicolons everywhere else (comments, log messages, docs, `context/` files, and feature specs). Code syntax is not affected

## Leftovers

19. Stale `TODO` and `FIXME` comments (list each with its file and line)
20. Orphaned or unused files in `src/`, `prisma/`, and `context/`
21. Packages in `package.json` that nothing imports
22. Temporary files that should not exist or be committed, such as `.playwright-mcp/` contents, screenshots, or database dumps

**Mode: $ARGUMENTS**

If no argument or the argument is "check":

- Only report findings, and don't modify anything
- List what WOULD be cleaned up, grouped by the headings above

If the argument is "run" or "fix":

- First, report all findings with numbered items
- Mark any item whose fix falls under **Ask First** or **Never** in @context/ai-interactions.md (for example schema changes, security-sensitive code, deleting files, or removing a dependency)
- Then ask: "Which items would you like me to fix? (enter numbers like 1,3,5 or 'all' or 'none')"
- Wait for the user's response before making any changes
- Only fix the items the user specifies. Items marked Ask First still need their own confirmation, even under "all"
- Make the fixes on a `chore/cleanup` branch, and don't commit without permission
- Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, and `npm run build` after fixing
- Report what you changed
