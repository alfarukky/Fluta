# Fix — Staff set the unit price of quote-required lines when pricing

To do right after Feature 13b (Booking Improvements). Work on a branch named `fix/quote-line-unit-price`. Follow @context/ai-interactions.md and @context/coding-standards.md.

## Problem

When pricing an order (Feature 12, `priceRevisionLines` in `src/server/domain/quotes.ts`), staff can only enter a line's quantity. Every line keeps the unit price it was added at, which for a quote-required service is its "from" price. After inspecting an item, staff can only charge more through an Others line, so a quote reads "Duvet × 1 ₦3,000" plus "Duvet, heavy (extra) ₦1,500" instead of "Duvet × 1 ₦4,500". A "Price on inspection" (₦0) line always totals ₦0. Feature 13 makes this common, because online quote-required items all arrive as estimates for staff to price.

## Decision (2026-10-15)

- When pricing, staff may set the **unit price of quote-required lines**, from ₦0 to ₦10,000,000, validated on the server
- **Non-quote lines keep their original price**, as now, so fixed prices stay protected from catalogue changes
- The new price goes through the normal revision and customer approval (Feature 12)

## Changes

### Quote editor

- Each **quote-required** line gets a unit price field, pre-filled with the line's current price (its "from" price, or ₦0 for "Price on inspection"). It accepts input through `parseNairaToKobo`, so "₦4,500", "4,500", and "4500" all work
- **Non-quote lines** keep showing their price as fixed text with no field
- The line total and the revision total update as staff type, as a preview only
- Uses the shared scroll-to-first-error behaviour if a price is invalid

### Server (`priceRevisionLines` and the revision action)

- The revision request may now include a unit price **only for lines whose `requiresQuote` flag is set**. The server checks the flag from the line in the database, never from the request
- A unit price sent for any non-quote line is refused, and the whole revision is refused with it
- The unit price must be a whole number of kobo from 0 to 1,000,000,000 (₦0 to ₦10,000,000). Anything else is refused
- When no unit price is sent for a quote-required line, it keeps its current price, as now
- Newly added quote-required lines start at today's catalogue price and can then be priced the same way
- The server still builds every total: line total = unit price × quantity (per-kg using the existing whole-number rounding helper), then the revision total, exactly as before
- The new unit price is stored in the revision's `linesSnapshot`, and in the working line once the revision is issued. Revisions are never edited, as before

### What the customer sees

- The line at its real price in the quote and, once approved, on the receipt: "Duvet × 1 ₦4,500"
- The usual old total, new total, difference, and reason, from Feature 12

### Approval and money

- Nothing changes in approval or balances. The new price only affects `getBalance` once the revision is approved, like every other change

## Do not change

- Non-quote lines' prices, or the rule that they keep their original price
- How revisions are approved, declined, or superseded
- The schema. No migration is expected. If one seems needed, stop and explain why

## Tests

- Unit tests:
  - a quote-required line can be priced, including from ₦0 ("Price on inspection") and for per-kg lines
  - a unit price sent for a non-quote line is refused
  - a negative price, a price above ₦10,000,000, and a non-whole kobo amount are refused
  - a quote-required line with no price sent keeps its current price
- Integration tests:
  - pricing a quote-required line issues a revision whose `linesSnapshot` holds the new unit price, and the balance changes only after approval
  - a request that tries to change a non-quote line's price is refused, and nothing is created
  - a FreshFold user cannot price a CleanWave order's line, even by sending its ID
- Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, the related integration tests, and `npm run build`

## Verify

With the Playwright MCP, at ~360px and desktop, light and dark:

- On FF-1013, price the Leather jacket above its "from" price and the Wedding gown from ₦0, issue the revision, and record approval. Confirm each line shows its real price and the balance updates only after approval
- Confirm a non-quote line (for example Shirt) has no price field

## Records

- Record this fix in `context/current-feature.md` history
- Remove "staff setting the unit price of quote-required lines" from Feature 14's entry in `context/features/00-roadmap.md`

Do not commit until I approve.
