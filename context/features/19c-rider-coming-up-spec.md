# Feature 19c — "Coming up" in the Deliveries View

## Overview

Riders (and owners and staff) can see the pickups booked for the next 7 days, and how many orders will soon need delivery, so they can plan ahead. It's a small, read-only section added to the bottom of the Deliveries view from Feature 14b. Nothing else in the view changes.

## Requirements

### What "Coming up" shows

**Pickups for the next 7 days**, starting tomorrow, grouped by day:

- A heading per day with a count: "Tomorrow, Fri 31 Oct · 3 pickups", then "Sat 1 Nov · 1 pickup", and so on. Days with no pickups are left out
- The 7 days are calendar days in the store's time zone, starting tomorrow: today is never included, and day 8 is not included
- Under each day, one short line per pickup: the **time window** (12-hour) and the **area name** (the order's own area copy, or "Outside our service areas"). For example: "10:00 AM – 12:00 PM · Wuse"
- Sorted by window start within each day
- **Only confirmed pickups** (pickup orders at Pickup scheduled, with a confirmed time)

**Waiting for confirmation:** one quiet line counting pickup orders currently at **Booked** whose time is still **requested** or **suggested by the store** (not yet confirmed), with that date within the 7 days. For example "2 more pickups are waiting for the store to confirm a time." No details

**Deliveries coming soon:** one line counting pickup orders currently at **Picked up, Received by store, Quote awaiting approval, or In progress**. Ready and later stages are not counted. For example "4 orders are being cleaned and will need delivery." No dates, because Fluta promises no delivery time. (A customer occasionally collects in person instead, which is rare enough that the wording stays simple)

**Wording for counts** (singular and plural):

- "1 pickup" / "3 pickups"
- "1 more pickup is waiting for the store to confirm a time." / "2 more pickups are waiting for the store to confirm a time."
- "1 order is being cleaned and will need delivery." / "4 orders are being cleaned and will need delivery."

**Empty state:** "Nothing coming up in the next 7 days", shown **only** when there are no confirmed pickups, none waiting for confirmation, and no orders being cleaned. If only some are zero, the section shows whatever lines have something to say

### What it never shows

- The customer's name, phone, or address
- Order numbers or links to orders
- Prices, totals, or payment information
- Any buttons or moves. It is for planning only. Pickups move to the normal "Pickups" section on their day, as now

### Keeping it simple

- One section at the bottom of the Deliveries view, titled "Coming up", below today's work so it never pushes today's jobs down
- Plain lines of text, no cards, no badges, no maps
- On phones it stays one column, readable at a glance
- The same for riders, staff, and owners

### Data and access

- Built by a data function next to Feature 14b's Deliveries data function. It selects only what it needs from the database and returns exactly this, with no IDs or anything else:
  - for each confirmed pickup: its date, window start and end, and the order's area copy
  - the count of pickups waiting for confirmation
  - the count of orders being cleaned
- "Pickup orders" always means the pickup and delivery fulfilment type
- "Tomorrow" and the 7 days are calendar days in the store's time zone
- The same access as the Deliveries view: owners, staff, and riders of that store, with the store taken from the membership. Every query filters by it, so a FreshFold rider never sees CleanWave's work
- Drop-off orders never appear

## Not in this feature

- Customer details, order links, or moves for future days
- Assigning pickups to particular riders
- Delivery dates or times
- Days beyond the next 7

## Done when

- Unit tests: grouping by day in the store's time zone, only confirmed pickups listed, the waiting-for-confirmation count, the deliveries-coming-soon count, the singular and plural wording, and the empty state shown only when all three are zero
- Boundary tests in the store's time zone: a pickup dated today is not in "Coming up", tomorrow's is, and one dated day 8 is not
- Integration tests:
  - the data function returns exactly the listed fields, never IDs, names, phones, addresses, order numbers, or money
  - an order that moved past Pickup scheduled (for example Picked up) no longer appears as a confirmed pickup, and a Booked order with a confirmed time can't exist in the waiting count
  - drop-off orders and cancelled orders never appear, and today's pickups stay in the normal Pickups section, not in "Coming up"
  - a FreshFold rider sees only FreshFold's upcoming work
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP**, at ~360px and desktop, light and dark: as a rider, with confirmed pickups booked for tomorrow and later in the week, one unconfirmed pickup, and orders in progress, check the section reads clearly and shows no customer details
- **Next.js DevTools:** no runtime or build errors on `/deliveries`

## References

- @context/features/14b-deliveries-and-rider-role-spec.md (the Deliveries view, its data function, and rider rules)
- @context/features/14-guest-tracking-and-approvals-spec.md (confirmed and requested pickup times)
