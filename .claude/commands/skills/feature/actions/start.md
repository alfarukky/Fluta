# Start Action

1. Read current-feature.md - verify Goals are populated
2. If empty, error: "Run /feature load first"
3. Check out `staging` and bring it up to date (`git fetch origin`, then `git merge --ff-only origin/staging`). Confirm there are no uncommitted changes. If it can't fast-forward or the tree isn't clean, stop and report. Never branch from `main`: it is production
4. List any items from the **Ask First** section of ai-interactions.md that the goals involve. If there are any, describe them and wait for approval before continuing
5. Set Status to "In Progress"
6. Create and check out the feature branch **from `staging`**, named from the H1 heading:
   - Spec from `context/features/` → `feat/[name]` (e.g., "Workspace Shell" → `feat/workspace-shell`)
   - Spec from `context/fixes/` → `fix/[name]`
   - Inline chores → `chore/[name]`
7. List the goals, then implement them one by one, checking library APIs with Context7 before using them
