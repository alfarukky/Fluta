# Feature 07 — Fulfilment Settings

## Overview

Owners choose how their store fulfils orders (drop-off/collection, pickup/delivery, or both), list the service areas they cover with a fixed or quoted pickup/delivery charge, and set the shared pickup/delivery schedule. Replaces Feature 04's `/fulfilment` placeholder. Later features read these settings (staff order entry in Feature 09, customer booking in Feature 13); changing them never alters existing orders.

## Requirements

### Access (reuse Feature 03)

- `/fulfilment` is owner-only: the page calls `requireStoreMember({ role: "OWNER" })`; staff get the no-access page
- **Every Server Action** also calls `requireStoreMember({ role: "OWNER" })` itself
- The store comes **only** from the membership; a service area or closed-date ID from the client is only acted on if it belongs to that store
- A refused or invalid action returns an error result, shown as an error toast
- Data access through `src/server/data/fulfilment.ts`, scoped by `storeId`

### Editing allowed only when the store may be edited (also updates Features 05 and 06)

- The overview's access table allows owners to edit settings, services, and staff only while the store is **Active or Paused** and the subscription is **not Cancelled**. Add one shared server check that asks `getStoreAccess()` for this capability (for example an option on `requireStoreMember` or a small `requireOwnerCanEdit()` helper)
- Use it in **every** owner editing operation, whether a Server Action or an API route: this feature's actions, Feature 05's store settings and branding actions **and its logo upload/remove route**, and Feature 06's service actions. A refused edit returns an error result explaining that the store can't be changed right now; API routes return HTTP 403 with the same message. The logo route checks before any R2 upload
- Viewing is unchanged: Feature 03's membership gate already refuses the whole workspace when existing orders can't be worked on (Cancelled subscription or Deactivated store). Whether Cancelled stores get read-only access stays **(Open)** in the overview; this check exists so edit and view rules can differ later by changing one place
- Record in the commit message and history that Features 05 and 06 actions were updated

### Fulfilment options

- Two toggles: **Drop-off & collection** and **Pickup & delivery**
- At least one must stay on; turning off the last one is refused with a clear message
- Turning an option off affects **new** orders only; existing orders keep their fulfilment type
- One pure function in `src/server/domain/` (for example `isPickupAvailable`) decides whether pickup can be booked: pickup & delivery on, at least one active area, and a valid schedule (at least one active day with hours). If pickup & delivery is on but this returns false, the page shows a warning that customers can't book pickup yet. Feature 13 reuses the same function

### Service areas

- A service area is a store-defined **named zone** (for example "Karu" or "Wuse 2"), meaning whatever the store and its customers understand by that name. Fluta does not check whether an address belongs to an area: no maps, boundaries, postcodes, or distance calculations. Customers choose an area; staff confirm it against the typed address and correct it through a revision if needed (Feature 12)
- Fields (validated with Zod on the server):
  - Name: required, 2–60 characters, trimmed; unique within the store ignoring case and extra spaces, including disabled areas, enforced by a `nameKey` column with `@@unique([storeId, nameKey])` (same pattern as services in Feature 06)
  - Charge type: **Fixed** or **Quote required**
  - Fixed charge: entered in Naira with `parseNairaToKobo`, stored in kobo, up to ₦1,000,000. ₦0 is allowed and displayed as "Free". Required for Fixed; must be empty for Quote required
- The area charge is **one charge per order covering both pickup and return delivery**, added to the order separately from the laundry lines. If only one trip happens, staff adjust it with an Others line (Features 09 and 12)
- Displayed charge: "₦1,500", "Free", or "Quote required"
- **No deleting:** areas are disabled and re-enabled. Disabling takes effect immediately with an undo toast (Undo calls the same re-enable action; leaving the page does not undo it). Disabled areas stay listed as inactive and are hidden from new orders in later features
- Editing or disabling an area never changes existing orders
- Add and edit in a drawer; Save is disabled while saving; sorted by name; empty state with an "Add area" action

### Pickup & delivery schedule

- **Active days:** Monday to Sunday toggles (stored as 0 = Sunday … 6 = Saturday). Each value is a whole number 0–6, no duplicates, stored sorted
- **Hours:** opening and closing time in the store's time zone, as `HH:MM` (24-hour), on a 15-minute step; closing must be after opening (no overnight hours)
- If pickup & delivery is on, at least one active day and both times are required
- **Closed dates:** add a date (today or later, in the store's time zone) with an optional note up to 100 characters; remove a closed date; the list shows upcoming dates only, soonest first. Adding the same date twice is refused with a friendly message (enforced by the existing `@@unique([storeId, date])`)
- These settings apply to pickup and delivery only, not drop-off
- The page states the time zone the hours follow, for example "Times are in West Africa Time (Africa/Lagos)"

### Pickup windows

- Customers choose from **fixed 2-hour windows** generated from the hours: starting at opening time, every 2 hours; the last window ends at closing time even if shorter (08:00–17:00 gives 08:00–10:00 … 14:00–16:00, 16:00–17:00). No setting to configure
- One pure function in `src/server/domain/` (for example `getPickupWindows(openTime, closeTime)`) generates them, with unit tests; Feature 13 reuses it
- The schedule section shows a preview: "Customers will see: 08:00–10:00, 10:00–12:00, …", updating as hours change

### Schema changes (Ask First)

One migration (hand-edited via `--create-only` for the CHECK constraints):

- Add `ServiceArea.nameKey` and `@@unique([storeId, nameKey])`; fill `nameKey` for existing areas; the seed sets it too
- CHECK: a store always has at least one fulfilment option on:

  ```sql
  ALTER TABLE "Store" ADD CONSTRAINT "Store_fulfilment_option_check" CHECK (
    "dropOffEnabled" = TRUE OR "pickupDeliveryEnabled" = TRUE
  );
  ```

- CHECK: the charge matches the charge type:

  ```sql
  ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_charge_check" CHECK (
    ("chargeType" = 'FIXED' AND "fixedCharge" IS NOT NULL AND "fixedCharge" >= 0)
    OR
    ("chargeType" = 'QUOTE_REQUIRED' AND "fixedCharge" IS NULL)
  );
  ```

### Page layout

- Three sections: **Fulfilment options**, **Service areas**, **Pickup & delivery schedule** (with closed dates)
- Desktop: areas as a table; mobile: stacked cards; no horizontal scrolling
- Times and dates always shown in the store's time zone using `time.ts`

## Not in this feature

- How far ahead and how soon customers can book a pickup (decided as fixed values in Feature 13, not settings here)
- Using these settings in orders (Feature 09) or on the booking page (Feature 13)
- Per-day hours, overnight hours, delivery dates or completion promises
- Rider assignment or logistics
- Deleting service areas

## Done when

- Unit tests: hours validation (closing after opening, 15-minute step), active-day validation, closed-date validation in the store's time zone (today allowed, past refused), charge display ("₦1,500", "Free", "Quote required"), `getPickupWindows` (even split, shorter last window, hours shorter than 2 hours), and `isPickupAvailable` (off; on without an area; on without a schedule; on with both)
- Integration tests:
  - staff cannot change any fulfilment setting
  - a FreshFold owner cannot change a CleanWave area or closed date, even by sending its ID
  - turning off both fulfilment options is refused, by the action and by the database
  - a Fixed area without a charge, or a Quote-required area with one, is refused, by the action and by the database
  - duplicate area names within a store are refused (case-insensitive, including disabled areas); two identical create requests at once produce one area
  - the same closed date can't be added twice
  - editing or disabling an area leaves existing orders unchanged
  - an owner whose subscription is Cancelled cannot save store settings (Feature 05), services (Feature 06), or fulfilment settings, nor upload or remove a logo (nothing written to the database or R2); viewing is refused too, as today
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as owner at ~360px and desktop, light and dark: toggle options (and see the refusal when turning off the last one); add, edit, disable (with undo) and re-enable an area; switch an area between Fixed and Quote required; set days and hours and see the window preview update; add and remove a closed date; see the warning when pickup is on without an area; staff opening `/fulfilment` see the no-access page
- **Next.js DevTools:** no runtime or build errors on `/fulfilment`
- **Neon MCP** (`development`, read-only): charges stored as integer kobo, Quote-required areas have no charge, `activeDays` and times saved as entered, closed dates stored as dates

## References

- @context/project-overview.md (Fulfilment, service areas, and scheduling; Data Model → `Store`, `ServiceArea`, `ClosedDate`)
- @context/coding-standards.md (Money, Time, and Phone Numbers; Security)
- @context/features/04-workspace-shell-spec.md (including "Decisions made during implementation")
- @context/features/06-service-catalogue-spec.md (money helpers, `nameKey` pattern, disable/undo behaviour)
