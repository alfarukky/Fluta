# Feature 06 — Service Catalogue

## Overview

Owners manage the services their store offers: name, price, pricing type, quote-required flag, and an optional category. Replaces Feature 04's `/services` placeholder. Prices are entered in Naira and stored in kobo. Later features read this catalogue (staff order entry in Feature 09, customer booking in Feature 13); changing it never alters existing orders, because order lines keep their own price snapshot.

## Requirements

### Access (reuse Feature 03)

- `/services` is owner-only: the page calls `requireStoreMember({ role: "OWNER" })`; staff get the no-access page
- **Every Server Action** also calls `requireStoreMember({ role: "OWNER" })` itself
- The store comes **only** from the membership, never from form data; a service ID from the client is only acted on if it belongs to that store
- A refused or invalid action returns an error result, shown as an error toast
- Data access through `src/server/data/services.ts`, scoped by `storeId`

### Money helpers

- `src/lib/money.ts` with unit tests:
  - `formatNaira(kobo)` → "₦6,200" (shows kobo only when non-zero, e.g. "₦1,500.50"); negative amounts as "−₦500" (used by discounts and refunds in later features)
  - `parseNairaToKobo(input)` → integer kobo from owner input. The ₦ sign and surrounding spaces are stripped; commas are allowed only as thousands separators; at most two decimal places. These cases are its unit tests:

    | Input | Result |
    | --- | --- |
    | `1500`, `1,500`, `1500.5`, `1500.50`, `1,500.50` | Accepted |
    | `₦1,500`, `₦ 1,500`, `  1,500  ` | Accepted |
    | `1.500,50` (European format) | Rejected |
    | `1,500,50`, `15,00` (commas not in groups of three) | Rejected |
    | `1.234`, `1.500` (more than two decimal places) | Rejected |
    | `-100`, `abc`, empty | Rejected |

  - The price field shows a ₦ symbol before the input box; after saving, the stored value is shown back formatted with `formatNaira`
- `formatServicePrice(service)` (in `money.ts` or a services helper) → "₦800 / item", "₦1,500 / kg", "₦2,500 / package", and for quote-required services "from ₦5,000 / item", or "Price on inspection" when the from price is ₦0. Used here now and by Features 09 and 13

### Service rules

- Fields (validated with Zod on the server):
  - Name: required, 2–80 characters, trimmed before saving; unique within the store, ignoring case and extra spaces, **including disabled services** ("A disabled service with this name exists. Re-enable it instead.")
  - Uniqueness is enforced by the database: a `nameKey` column (lowercase, trimmed, repeated spaces collapsed) is set by the server whenever the name changes, with `@@unique([storeId, nameKey])`. A unique-rule rejection returns the friendly duplicate message, not an error
  - Category: optional free-text label, up to 40 characters. The field suggests the store's existing categories as the owner types; a new category matching an existing one (ignoring case and extra spaces) uses the existing spelling
  - Pricing type: per item, per kg, or per package
  - Price: entered in Naira, stored in kobo; up to ₦10,000,000. Must be greater than zero unless the service requires a quote (then it is the "from" price and may be zero)
  - Quote required: a flag
- **Per-kg services always require a quote:** choosing per kg turns the flag on and locks it; the server enforces this regardless of what the form sends. Switching from per kg to another pricing type leaves the flag on but editable again
- **No deleting:** services are disabled and re-enabled instead. Disabled services stay in the list (marked inactive) but are hidden from staff order entry and customer booking in later features
- Editing a service never changes existing orders (order lines keep their snapshot)

### Schema change (Ask First)

- Add `Service.nameKey` and `@@unique([storeId, nameKey])` in one migration that fills `nameKey` for existing services; the seed sets it too
- Same migration (hand-edited via `--create-only`): a CHECK constraint so a per-kg service can never have `requiresQuote = false`, on create or edit:

  ```sql
  ALTER TABLE "Service" ADD CONSTRAINT "Service_per_kg_requires_quote" CHECK (
    "pricingType" <> 'PER_KG' OR "requiresQuote" = TRUE
  );
  ```

### Services page

- List as in the overview's UI section: name, category, pricing type, price (via `formatServicePrice`), a "Quote required" badge where it applies, and active/inactive status
- Search by name and filter by category (categories come from the store's existing services; matching ignores case and extra spaces)
- Sorted by category, then name; services without a category last
- Add and edit in a drawer (sheet) with the fields above; Save is disabled while a save is in progress; disable/enable from the list or drawer without a confirmation dialog, with an undo toast. Disabling takes effect on the server immediately; Undo calls the same re-enable action and is available while the toast is shown. Leaving the page does not undo it
- Empty state (no services yet) using the existing `EmptyState` component, with an "Add service" action
- Desktop: table; mobile: stacked cards; no horizontal scrolling

## Not in this feature

- Fulfilment settings, service areas, schedule (Feature 07)
- Using services in orders (Feature 09) or on the booking page (Feature 13)
- Service images, custom display order, bulk import, and price history
- Deleting services

## Done when

- Unit tests: `formatNaira` (including negative amounts), `parseNairaToKobo` (valid and invalid inputs), `formatServicePrice` for every pricing type, the quote-required "from" price, and "Price on inspection" at ₦0
- Integration tests:
  - staff cannot create, edit, or disable services
  - a FreshFold owner cannot change a CleanWave service, even by sending its ID
  - a per-kg service is always saved with quote required, even if the request says otherwise
  - duplicate names within a store are rejected (case-insensitive), including against disabled services; the same name in another store is allowed
  - two identical create requests sent at once produce exactly one service
  - inserting or updating a per-kg service with `requiresQuote = false` directly in the database is rejected
  - a new category differing only in case or spacing is saved with the existing spelling
  - a whitespace-only category is saved as `NULL`
  - editing a service's name, price, pricing type, or quote flag, or disabling it, leaves every existing order line unchanged (seeded orders)
  - a disabled service can be re-enabled; nothing is ever deleted
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as owner at ~360px and desktop, light and dark: add, edit, disable (with undo) and re-enable a service; choosing per kg locks quote required; search and category filter; empty state; staff opening `/services` see the no-access page
- **Next.js DevTools:** no runtime or build errors on `/services`
- **Neon MCP** (`development`, read-only): prices stored as integer kobo, per-kg services have `requiresQuote = true`, disabled services have `isActive = false`

## References

- @context/project-overview.md (Service catalogue, UI / UX → Services, Data Model → `Service`)
- @context/coding-standards.md (Money, Time, and Phone Numbers; Security)
- @context/features/04-workspace-shell-spec.md (including "Decisions made during implementation")
- @context/features/05-store-settings-branding-spec.md
