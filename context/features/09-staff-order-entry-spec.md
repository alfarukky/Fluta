# Feature 09 — Staff Order Entry

## Overview

Owners and staff create orders received at the counter, by phone, or through WhatsApp. This is the first feature that creates orders, so it establishes how an order, its lines, its version 1 revision, its number, and its first status event are written together. It reuses Feature 06's catalogue and money helpers, Feature 07's fulfilment settings, pickup windows, and availability check, and the snapshot rules in the overview.

## Requirements

### Access

- `/orders/new` is open to owners and staff (`requireStoreMember()`)
- Creating an order also requires the store to be **accepting new orders** per `getStoreAccess()` (store Active, subscription Active or Overdue); otherwise the page explains that the store can't take new orders right now and the action is refused
- The store comes only from the membership; customer, service, and area IDs from the client are only used if they belong to that store
- Data access through `src/server/data/orders.ts` and `src/server/data/customers.ts`, scoped by `storeId`

### Customer

- Search existing customers by phone or name, or add a new one
- New customer: name (2–80 characters), phone (required, via `phone.ts` with `"NG"` as the default country), email (optional, via `normalizeEmail()`)
- A phone number that already belongs to a customer of this store reuses that customer (customers are unique per store by phone); the form shows the existing name rather than silently overwriting it
- The customer is found or created in one step (an upsert on store and phone), inside the order transaction. An existing customer's name is never overwritten

### Order details

- **Channel:** Counter, Phone, or WhatsApp (Online is only for customer bookings in Feature 13)
- **Fulfilment:** only the options the store has enabled
- **Drop-off:** no address or schedule
- **Pickup & delivery** is only offered when the store has it turned on, always. "Outside our service areas" lifts only the active-area requirement, and "Outside normal schedule" lifts only the open-day requirement. Neither allows pickup when the store has it turned off:
  - Service area from active areas, **or** "Outside our service areas" with a free-text area name, which sets `isOutOfArea`. The name is stored only on the order (`serviceAreaName`, with no `serviceAreaId`) and never creates a service area
  - Address: required, up to 200 characters (one address for pickup and delivery)
  - Pickup date: today or later in the store's time zone, on an active day, not a closed date
  - Pickup window from `getPickupWindows()`, shown in 12-hour format
  - **Outside normal schedule:** staff may tick this to pick any date (today or later) and enter a custom start and end time with the 12-hour controls (end after start), for example a Sunday pickup or a 7:00 PM pickup the store agreed to. Without it, staff choose from the normal windows. It sets `Order.isOutsideSchedule`, and the internal note becomes required to explain it. Customers booking online (Feature 13) never get this option
  - Staff-entered windows are agreed with the customer directly: both the requested and scheduled window fields are set to the chosen window, with `pickupWindowStatus = CONFIRMED`
  - Charge: a fixed area's charge is filled in; a quote-required area or an out-of-area order needs staff to enter the agreed charge (₦0 allowed)
- **Internal note:** optional, up to 500 characters, never shown to customers

### Lines

- **Service lines** from active services only, showing `formatServicePrice()`:
  - Per item / per package: whole-number quantity, 1–999
  - Per kg: weight in kg, 0.1–999.99 (up to two decimals). On quote-required lines the weight may be left empty if the clothes aren't weighed yet; an optional customer estimate can be recorded in `estimatedQuantity`
- **Adjustment lines ("Others"):** a required description (up to 100 characters), a choice of **Extra charge** or **Discount**, and an amount entered with `parseNairaToKobo`; stored as a positive or negative `lineTotal`
- At least one service line is required
- Adding a service that's already on the order combines the quantities into one line (for example "Shirt × 2" plus "Shirt × 3" becomes "Shirt × 5")
- **The server builds every price.** The browser sends only service IDs, quantities or weights, adjustments, and the area choice. For each line the server loads the service (this store's, and active) and takes the name, price, pricing type, and quote flag from it. Repeated service IDs are merged into one line. A fixed area's charge comes from the area. Only quoted and out-of-area charges are entered by staff
- **Snapshots** at creation: service name (`description`), `pricingType`, `requiresQuote`, and `unitPrice` are copied onto each line; later catalogue changes never touch them
- **Line totals:** per-item/package = unit price × quantity; per-kg = unit price × weight, rounded **half up to the nearest kobo**, in one shared `money.ts` helper
- The per-kg helper uses whole-number arithmetic only (weight in hundredths of a kg × price in kobo), never JavaScript decimal numbers
- **Order total** = service line totals + adjustment amounts + fulfilment charge; it may not be negative

### Creating the order (one transaction)

All of these happen together, or none do:

1. Allocate the order number from `Store.nextOrderNumber` (atomic update, as in the overview)
2. Create the order with channel, fulfilment, customer, `serviceAreaId`, `serviceAreaName` and `fulfilmentCharge` copies, address, window fields, a tracking token **hash** (32 random bytes; the raw token is not shown or sent in this feature), and `createdByUserId`
3. Create the lines with their snapshots
4. Create **version 1** of the quote revision (`createdByActor = STAFF`, with the creating user):
   - Whether the order is fully priced is decided by one shared function in `src/server/domain/` (for example `isOrderFullyPriced`), reused by Feature 12
   - **Fully priced** (every quote-required line has its quantity, and any quote-required charge is entered): approved at once (`approvedByActor = STAFF`, agreed with the customer directly), and `approvedQuoteId` points to it
   - **Not fully priced** (a quote-required line is still unweighed): version 1 records the estimate and stays unapproved; the priced quote comes later (Feature 12)
5. Set the starting stage with one shared function (for example `getInitialStage`):
   - Counter + drop-off → **Received by store**
   - Phone or WhatsApp + drop-off → **Booked**
   - Any staff-entered pickup & delivery order → **Pickup scheduled** (window confirmed and charge agreed by staff)
6. Write the first `StatusEvent` (actor STAFF)

### Order numbers

- One `formatOrderNumber(store, orderNumber)` helper shows numbers everywhere as `{prefix}-{number}` (for example "FF-1024"). Never build the display by hand

### Double submits

- The form sends a one-time request ID generated when the form opens. Creating twice with the same ID returns the **same** order instead of a second one. Save is disabled while saving
- `clientRequestId` must be a UUID (generated in the browser with `crypto.randomUUID()` and validated with Zod). Duplicate protection relies on the database's unique rule, not a check-before-create: if creating hits the unique rule, the transaction is rolled back (so no order number is used up), and the existing order with that ID is returned instead
- The create-order action requires a non-empty `clientRequestId` and refuses requests without one. The column stays optional only for orders created outside the form (seed and existing data). Feature 13's online booking will require it the same way
- **Schema change (Ask First):** add `Order.clientRequestId` (`String?`) with `@@unique([storeId, clientRequestId])`, and `Order.isOutsideSchedule` (`Boolean`, default `false`)

### Order-line rule in the database (Ask First)

- In the same migration, a CHECK constraint so a per-kg order line always has `requiresQuote = true` (the rule noted in Feature 06):

  ```sql
  ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_per_kg_requires_quote" CHECK (
    "pricingType" IS DISTINCT FROM 'PER_KG' OR "requiresQuote" = TRUE
  );
  ```

### After creating

- Redirect to a simple order summary page `/orders/[id]` (number, customer, lines, total, stage, fulfilment); Feature 10 replaces it with the full order detail
- `/orders` gets a "New order" button; the list itself is Feature 10

### Page layout

- If the store has no active services, the page shows an empty state ("Add a service before creating orders", with a link to Services for owners) instead of the form

- One page, mobile-first, in sections: Customer → Order details → Lines → Review (total and stage it will start at) → Create
- Times in 12-hour format; money through `formatNaira`

## Not in this feature

- Orders list and full order detail (Feature 10)
- Changing stages, cancelling (Feature 11)
- Weighing later, priced quotes, revisions, customer approval (Feature 12)
- Customer booking (Feature 13)
- Tracking link display, resend, and SMS (Features 14 and 15)
- Payments (Feature 16)

## Done when

- Unit tests: per-kg rounding (half up, including exact half-kobo cases), order total including adjustments and charge, `getInitialStage` for every channel and fulfilment, "fully priced" detection, `formatOrderNumber`, combining repeated services
- Integration tests:
  - staff and owners can create orders; a store not accepting new orders refuses creation
  - a FreshFold user cannot use a CleanWave customer, service, or area, even by sending its ID
  - every created order has a unique number, its lines, version 1, its first status event, and a token hash, all or nothing
  - a fully priced order has an approved version 1 and `approvedQuoteId`; an unweighed per-kg order has an unapproved version 1 and no `approvedQuoteId`
  - two creates with the same request ID sent at the same time produce one order, and both requests receive that same order; concurrent creates with different IDs get different numbers
  - a create request without a request ID is refused
  - two orders created at the same time for the same new phone number share one customer
  - a request that sends its own unit price or area charge is ignored, and the order uses the catalogue and area values
  - an out-of-area pickup is refused when the store has pickup & delivery turned off
  - a per-kg order line with `requiresQuote = false` is rejected by the database
  - a negative order total is refused
  - a pickup on a closed date, an inactive day, or at a time outside the normal windows is refused unless "Outside normal schedule" is ticked with a note; with it, the order saves with `isOutsideSchedule = true` and the custom times
  - changing a service or area after creation leaves the order's copies unchanged
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as staff at ~360px and desktop, light and dark: counter drop-off with a new customer; phone pickup in a fixed area; WhatsApp pickup out of area with an entered charge; a Sunday 7:00 PM pickup using "Outside normal schedule"; a per-kg line left unweighed; an Others discount; double-tap Create produces one order; summary page shows the right number, total, and stage
- **Next.js DevTools:** no runtime or build errors on `/orders/new` and `/orders/[id]`
- **Neon MCP** (`development`, read-only): order, lines, version 1, status event, and copies are as entered; kobo amounts are integers

## References

- @context/project-overview.md (Order intake, Order stages and transitions, Quotes and revisions, Data Model → `Order`, `OrderLine`, `QuoteRevision`, `StatusEvent`, `Customer`)
- @context/coding-standards.md (Database → transactions; Money, Time, and Phone Numbers)
- @context/features/06-service-catalogue-spec.md
- @context/features/07-fulfilment-settings-spec.md
