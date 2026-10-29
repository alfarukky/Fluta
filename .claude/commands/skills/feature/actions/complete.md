# Complete Action

Running `/feature complete` is the permission ai-interactions.md requires to commit, merge into `staging`, delete the feature branch, and push `staging`. Run `/feature review` first; the checks below are a final gate for any change made after the review.

`main` is production. This command never merges into `main` and never pushes it. `main` changes only through a pull request from `staging`, opened by the project owner.

1. Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build`, in that order. If any fail, stop and report. Do not commit
2. Review `git status`:
   - Never stage `.env*` files (except `.env.example`), secrets, or temporary files
   - If `schema.prisma` changed, confirm the migration files are included and `npx prisma migrate status` is in sync
3. Stage the feature's changes and commit with a descriptive message
   - The commit message must follow your rules: conventional format (`feat:`, `fix:`), mention any schema change, and never include "Generated With Claude."
4. Bring `staging` up to date (`git fetch origin`, check out `staging`, `git merge --ff-only origin/staging`), then merge the feature branch into it (no push yet). If `staging` can't fast-forward, stop and report
5. Delete the local feature branch
6. Reset current-feature.md:
   - Change H1 back to `# Current Feature`
   - Clear Spec, Goals, Not in this feature, Done when, Verify with, References, Schema changes, and Notes sections (keep placeholder comments)
   - Set Status back to "Not Started"
   - Add feature summary to the END of History
7. Commit the reset on `staging`: `chore: reset current-feature.md after completing [feature]`
8. Push `staging` to origin ONCE (single push with all changes). Railway deploys it to the staging site
9. If the feature branch was previously pushed, delete it from origin
10. Remind the project owner that the change is on staging only; production gets it when they open and merge a pull request from `staging` to `main`
