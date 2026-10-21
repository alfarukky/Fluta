# Load Action

1. Check $ARGUMENTS (after "load"):
   - If it looks like a filename (single word, no spaces): Look for `context/features/{name}.md` OR `context/fixes/{name}.md`
   - If it's multiple words: Use as inline feature description, generate goals
   - If empty: Error - "load" requires a spec filename or feature description

2. Update current-feature.md:
   - Update H1 heading to include feature name (e.g., `# Current Feature: Workspace Shell`)
   - Under `## Spec`, record the spec file path (or "inline description") and which sections of project-overview.md the feature implements
   - Write goals as bullet points under `## Goals` (from the spec's Requirements)
   - Copy the spec's guardrails into their own sections, word for word:
     - `## Not in this feature`
     - `## Done when`
     - `## Verify with` (if the spec has it)
     - `## References`
   - Under `## Schema changes`, list any changes to `schema.prisma` the spec requires, or "None"
   - Write any additional notes/context under `## Notes`
   - Set Status to "Not Started"

3. Confirm spec loaded and show the feature summary, including any schema changes and any items from the **Ask First** section of ai-interactions.md that the goals involve
