# Test Action

1. Read current-feature.md to understand what was implemented
2. Identify server actions, services, domain functions, data-access functions, and utilities added/modified for this feature
3. Check if tests already exist for these functions
4. Write the tests that are **required** by coding-standards.md:
   - Unit tests for every pure domain function and helper touched (`canTransition`, `getStoreAccess`, `getBalance`, money, phone, time, token helpers)
   - **Store-isolation integration tests** for any new or changed store-owned data: a Store A user cannot read, change, or link to Store B data
   - Any tests listed under `## Done when` in current-feature.md
5. For other functions with testable logic, use your best judgement:
   - Create unit tests using Vitest
   - Focus on server actions and utilities (not components)
   - Test happy path and error cases
   - Do not write tests just to write them
6. Integration tests run against the Neon `test` branch (`.env.test`), never `development` or `production`
7. Never weaken, skip, or delete a test to make it pass; fix the code, or explain why the test itself is wrong
8. Run `npm run test:unit`, then the integration test files related to this feature. Run the full `npm run test:integration` only once the related ones pass
9. Report test coverage for the new feature code, listing required tests separately from judgement-based ones
