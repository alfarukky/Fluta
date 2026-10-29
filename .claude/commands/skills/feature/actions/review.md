# Review Action

1. Read current-feature.md to understand the goals, Done when, and Not in this feature
2. Review all code changes made for this feature (`git diff staging` plus untracked files from `git status --short`)
3. Check for:
   - ✅ Goals met
   - ✅ Every `## Done when` item satisfied
   - ❌ Goals missing or incomplete
   - ⚠️ Code quality issues or bugs
   - 🚫 Scope creep: code beyond the goals, anything listed under `## Not in this feature`, or anything from the overview's Later / Out of scope lists
4. Check the Code Review list in ai-interactions.md:
   - Store isolation, security, money, consistency (transactions, `canTransition`, outbox), performance, edge cases, patterns
5. Run the Workflow step 4 checks from ai-interactions.md (do not just assume they were done earlier):
   - `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass
   - Next.js DevTools shows no runtime or build errors
   - Playwright MCP checked at ~360px and desktop, light and dark themes
   - Neon MCP checked database changes (if the feature touches the database)
   - Any `## Verify with` steps done
6. Final verdict: Ready to complete or needs changes (list each required change)
