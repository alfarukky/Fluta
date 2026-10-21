# Feature 10 — Orders List and Order Detail

## Overview

Owners and staff find any order quickly and see everything about it on one page. This feature replaces Feature 09's simple summary page with the full order detail, adds the orders list with search and filters, and adds the open-orders count to the sidebar. It is **read-only**: changing stages, quotes, and payments come in Features 11, 12, and 16. It also introduces `getBalance`, the one shared function that works out an order's payment state.

## Requirements

### Access

- `/orders` and `/orders/[id]` are open to owners and staff (`requireStoreMember()`). Viewing follows the existing workspace gate, so it works whenever staff can work on existing orders
- The store comes only from the membership. An order ID from another store, or one that doesn't exist, shows **"Order not found"** (HTTP 404), never "no access", so the page never reveals that an order exists elsewhere
- Data access through `src/server/data/orders.ts`, scoped by `storeId`

### Payment state (`getBalance`)

- One pure function in `src/server/domain/` (`getBalance`), as named in the coding standards, works out an order's balance and payment state:
  - It returns `{ state, approvedTotalKobo, confirmedPaymentsKobo, paidRefundsKobo, balanceKobo }`, where `state` is `AWAITING_QUOTE`, `PAID`, `OUTSTANDING`, or `REFUND_OWED`
  - `balanceKobo = approvedTotalKobo − confirmedPaymentsKobo + paidRefundsKobo`. **Paid** at 0, **Outstanding** above 0, **Refund owed** below 0
  - With no approved quote (for example an unweighed per-kg order), `state` is `AWAITING_QUOTE` and `approvedTotalKobo` and `balanceKobo` are `null`, never 0. It never shows a balance based on estimates
  - Counted: payments with status `CONFIRMED` and no void, and refunds with no `voidedAt`. Not counted: `PENDING`, `FAILED`, or `VOIDED` payments, and voided refunds
  - For a cancelled order, the approved total counts as zero while confirmed payments and paid refunds still count, so anything already collected becomes refund owed
- **Payment required** and **Pending** depend on online payments and are added in Features 13 and 17. `getBalance` is written so they can be added without changing callers
- Features 16 to 20 reuse `getBalance`. No other code works out a balance

### Orders list (`/orders`)

- **New order** button (Feature 09)
- **Search** in one box:
  - Order number in any form: "1024", "FF-1024", or "ff1024"
  - Customer phone, matching any part of the number. One `phone.ts` helper converts the search text: keep digits only, and if they start with `0` (local Nigerian format) replace it with `234`, then match any part of the stored number. "0803 123", "803123", and "+234 803 123" all find `+2348031234567`
  - Customer name, matching any part, ignoring capitals
  - Search input is normalized (trimmed, spaces and hyphens removed, uppercased). It is treated as an order number only if it is digits, optionally after letters. Letters that don't match the store's prefix make the number part match nothing. Name and phone matching always run as well, so no input is an error
- **Filters:** stage, payment state, fulfilment type, and created date (Today, Last 7 days, Last 30 days, All). The date ranges are calendar days (today plus the previous 6 or 29 days) in the store's time zone, converted to UTC only for the database query
- Search and filters live in the page address, so the back button, refresh, and shared links keep them. They are validated with Zod, and invalid values fall back to the defaults
- **Each row:** order number (`formatOrderNumber`), customer name, a short services summary ("Shirt × 4, Trousers × 2" then "+2 more"), total (approved total with `formatNaira`, or "Awaiting quote"), payment badge, stage badge, created date and time (12-hour, store time zone), and for pickup orders the pickup date and window
- Newest first, 25 per page, loaded page by page as the user scrolls or taps "Load more" (no total page count). Loading uses a cursor based on created time and ID, not page numbers, so new orders never cause duplicates or skipped rows
- Desktop: table. Mobile: stacked cards. No horizontal scrolling
- Empty states (using `EmptyState`): no orders yet ("Create your first order") and no matches ("No orders match these filters", with Clear filters)
- The list loads with a fixed number of database queries, no matter how many rows (no query per row)

### Sidebar count

- The **Orders** nav item shows the number of **open** orders (any stage except Completed and Cancelled), as deferred from Feature 04. It is loaded once per request and updates on the next page load

### Order detail (`/orders/[id]`)

- **Header:** order number, customer name, stage badge, payment badge, created date and channel. No stage or payment actions yet (Features 11 and 16)
- **Order summary:**
  - Service lines with quantity or weight, unit price, and line total. An unweighed per-kg line shows "To be weighed", with the customer's estimate labelled as an estimate if there is one
  - Adjustment lines with their description, shown as "Extra charge" or "Discount"
  - Pickup and delivery charge (from the order's copy), or "Quote required" if not yet set
  - Approved total, or "Awaiting quote" with any indicative total clearly labelled as not final
- **Customer:** name, full phone with a **Call** button (`tel:` link), and email if present. The WhatsApp button comes with Feature 15, because opening WhatsApp is logged
- **Fulfilment:** type, the area name copy (marked "Outside our service areas" when out of area), address, pickup date, and requested and confirmed windows in 12-hour format. An outside-schedule pickup shows an **Outside normal schedule** badge
- **Internal note**, labelled as staff-only
- **Timeline:** every status event, newest first, with stage, time (12-hour, store time zone), and who did it (staff name or "Customer" or "System")
- **Quote history:** each revision's stored version, total, status, and date. Read-only. A version 1 that was never sent for approval (an order not fully priced at creation) is labelled **Estimate**, not "Awaiting approval"
- **Payments:** confirmed, pending, and voided payments and paid refunds with amount, method, date, and reference. Voided records are shown struck through and excluded from totals. Read-only
- Everything shown comes from the order's own copies, never from the current service or area records
- The detail page loads with a fixed number of database queries. Nothing is looked up per line, revision, payment, refund, or timeline event. Staff names for the timeline are fetched together in one query
- Loading, error, and not-found states

## Not in this feature

- Changing stages, cancelling, stepping back (Feature 11)
- Weighing, priced quotes, revisions, approvals (Feature 12)
- Tracking link display and resend, WhatsApp button, SMS (Features 14 and 15)
- Recording payments, voids, refunds (Features 16 to 18)
- Print receipt (Feature 19) and Repeat order (Feature 21)
- Editing an order's address or details

## Done when

- Unit tests:
  - `getBalance`: paid, outstanding, refund owed, awaiting quote (null balance), a cancelled paid order becoming refund owed, and pending, failed, and voided payments and voided refunds excluded
  - phone search helper: "0803 123", "803123", "+234 803 123", and "2348031234567" all match `+2348031234567`
  - order number normalization: "1024", "FF-1024", "ff1024", and " ff - 1024 " match FF-1024, "CW1024" at FreshFold matches no order number, and "ABC" and "12.5" search names and phones without error
- Integration tests:
  - a FreshFold user cannot see a CleanWave order in the list or by its ID, and the detail page returns 404, not "no access"
  - search by number, phone part, and name part, each within the store only
  - every filter, alone and combined, including date filters across midnight in the store's time zone
  - the sidebar count matches the number of open orders
  - the list uses a fixed number of queries for one page, whatever the number of rows
  - an order created while scrolling causes no duplicated or skipped rows on "Load more"
  - an order with many timeline events, revisions, and payments loads its detail page with the same number of queries as a simple order
  - an unpriced order's version 1 is labelled "Estimate"
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as staff at ~360px and desktop, light and dark: search each way, apply and clear filters, use the back button with filters kept, load more, open an order and check every section, open an order with an unweighed per-kg line, open another store's order ID and see "Order not found"
- **Next.js DevTools:** no runtime or build errors on `/orders` and `/orders/[id]`
- **Neon MCP** (`development`, read-only): totals and balances shown match the approved revisions and payments in the database

## References

- @context/project-overview.md (UI / UX → Orders and Order detail, Order stages, Payment states, Data Model)
- @context/coding-standards.md (Data Fetching, Money, Time, and Phone Numbers)
- @context/features/04-workspace-shell-spec.md (sidebar)
- @context/features/09-staff-order-entry-spec.md (order structure, `formatOrderNumber`)
