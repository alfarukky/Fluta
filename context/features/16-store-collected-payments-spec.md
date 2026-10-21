# Feature 16 — Store-Collected Payments

## Overview

Staff record payments customers make at the store or directly to the store: cash, bank transfer, POS, or other. Owners can void a payment recorded by mistake and record the correct one. Every payment shows immediately in the order's payment state through `getBalance` (Feature 10). A Payments page lists the store's payments. Online Paystack payments come in Feature 17, and refunds in Feature 18.

## Requirements

### Action results

- Every action in this feature returns the app's built shape, `{ ok, message, fieldErrors? }`, like the existing actions (for example `src/actions/store-settings.ts`)

### Access

- Owners and staff can record payments (`requireStoreMember()`). Riders cannot
- Only owners can void payments
- Recording and voiding both require the store's existing-orders capability from `getStoreAccess` (the same one stage changes use). When the store can't work on existing orders, neither is allowed
- The store comes only from the membership. An order or payment from another store returns "Order not found" or is refused

### Recording a payment

- **Record payment** on the order detail page. It is the primary action when the order is Ready or Completed with a balance due, and a secondary action otherwise
- Fields:
  - **Amount:** entered with `parseNairaToKobo`, more than ₦0 and up to ₦10,000,000
  - **Method:** Cash, Bank transfer, POS, or Other (the `PAYSTACK` method is never allowed here)
  - **Reference:** optional, up to 100 characters (for example a transfer or POS reference)
  - **Note:** optional, up to 200 characters
- Saved as a `Payment` with `source = STORE_COLLECTED`, `status = CONFIRMED`, `confirmedAt` now, and `recordedByUserId`. A store-collected payment is confirmed the moment staff record it
- **When payments can be recorded:**
  - On any open order, including **before the price is approved** (a deposit). Until a price is approved, the order shows "Paid so far: ₦X" instead of a balance, because `getBalance` gives no balance yet
  - On a **Completed** order (customers who pay on collection, or later)
  - **Never on a Cancelled order.** Money owed back there is handled with refunds (Feature 18)
- **Paying more than the balance:** allowed, after a clear confirmation: "This is ₦X more than the balance due. The store will owe the customer ₦X." The order then shows Refund owed through `getBalance`
  - **The server decides, using the current balance.** The form tells the server whether staff saw and confirmed an overpayment warning. When saving, the server works out the balance as it is now. If the payment is more than that balance and staff didn't confirm an overpayment (for example because someone else recorded a payment while the form was open), nothing is saved and the form shows: "The balance has changed. ₦X is now due. This payment is ₦Y more. Record it anyway?" Overpayments are only ever recorded deliberately
- The form shows the current balance due and pre-fills it as the amount, which staff can change (for example a part payment)
- Save is disabled while saving

### Double submits (Ask First, schema change)

- The form sends a UUID request ID created when it opens. Recording twice with the same ID returns the same payment instead of a second one
- Add `Payment.clientRequestId` (`String?`) with `@@unique([storeId, clientRequestId])` in one migration. The record-payment action requires it. Duplicates are caught by the database's unique rule, as in Feature 09
- The same migration adds a database check on payment states: a `CONFIRMED` payment has `confirmedAt` and no void details, and a `VOIDED` payment keeps its `confirmedAt` and has `voidedAt`, `voidedByUserId`, and `voidReason`
- The same migration makes `Payment.replacesPaymentId` unique, and adds a database check: a payment with `source = STORE_COLLECTED` must use `CASH`, `BANK_TRANSFER`, `POS`, or `OTHER`, never `PAYSTACK`. Feature 17's migration adds the matching rule for online payments

### Voiding a payment (owners only)

- On the order detail page, a confirmed store-collected payment offers **Void payment** to owners
- A reason is required (up to 200 characters)
- Two choices:
  - **Void only:** the payment becomes `VOIDED` with `voidedAt`, `voidedByUserId`, and `voidReason`
  - **Void and record correct payment:** in **one transaction**, the payment is voided as above, and a new confirmed payment is recorded with the corrected amount, method, reference, and note, and `replacesPaymentId` pointing to the voided one
- **Retries are safe:**
  - Void and replace sends its own request ID, saved as the replacement payment's `clientRequestId`. A retry with the same ID returns the existing replacement as a success, never an error or a second payment
  - A retried "Void only" that finds the payment already voided returns success ("Payment voided")
  - `Payment.replacesPaymentId` is unique (added in this feature's migration), so a voided payment can have only one replacement. A replacement can itself be voided and replaced later, keeping a single chain
- Each void writes an `AuditEvent` with who, when, the reason, the original payment, and the replacement if any
- A voided payment stays in the history, shown struck through, and never counts in any total (as `getBalance` already does)
- Void reasons and audit details are staff-only. They never appear on the tracking page or in customer messages
- Only a `CONFIRMED`, `STORE_COLLECTED` payment can be voided, checked in one conditional update, so two owners voiding at once can't both succeed. Paystack payments can never be voided here (a mistaken online payment is handled as a refund, Feature 18)
- Payments are never edited or deleted

### Order detail page

- The payments section (Feature 10) gains Record payment and, for owners, Void payment
- The payment badge and balance update straight after each change, through `getBalance`
- Each recorded or voided payment appears in the staff timeline as its own payment entry, through Feature 12's timeline helper. Payments never create a `StatusEvent` or look like a stage change (for example "Payment recorded: ₦5,000 cash, by Ada" or "Payment voided: ₦5,000 cash, by Ada. Reason: Entered twice")

### Payments page (`/payments`)

- Owners and staff, from the existing Payments menu item
- Lists only **confirmed** and **voided** payments. Pending or failed attempts (from online payments in Feature 17) are never listed here. They belong on the order page
- Sorted, filtered, and paged by **when the payment was confirmed** (`confirmedAt`), so a payment counts on the day it was received
- A list of the store's payments, newest first: date and time confirmed (12-hour, store time zone), order number (linking to the order), customer name, amount, method, source (Store or Online), recorded by (a staff name, or "Online payment" for online payments from Feature 17), and status (voided ones struck through)
- Filters: date (Today, Last 7 days, Last 30 days, calendar days in the store's time zone), method, and source. Filters live in the page address
- **Owners only:** totals for the chosen period, split into store-collected and online. Totals count **only** payments whose status is `CONFIRMED`. A voided payment counts ₦0, even if it was received inside the period. Staff see the list without totals, because financial figures are owner-only
- Loads 25 at a time with "Load more", using a cursor, and a fixed number of database queries
- Desktop: table. Mobile: stacked cards

## Not in this feature

- Online Paystack payments (Feature 17)
- Refunds, including recording money paid back (Feature 18)
- Receipts (Feature 19)
- Payment messages to customers
- Backdating payments to an earlier date
- Editing or deleting payments

## Done when

- Unit tests: amount limits, the overpayment confirmation amount, and the "Paid so far" display before a price is approved
- Integration tests:
  - staff record each method, and the order's payment state updates through `getBalance` (outstanding, paid, refund owed)
  - a payment before price approval is saved and shown as "Paid so far"
  - a ₦5,000 deposit followed by an approved ₦4,000 price shows Refund owed ₦1,000
  - a paid order whose payment is voided shows Outstanding, and a newly approved lower price then shows the new outstanding amount, with the voided payment never counting again
  - a payment received on a date and voided later counts ₦0 in that period's totals, for both store-collected and online
  - the database refuses a confirmed payment with void details, and a voided payment missing its void details
  - recording a payment writes no status event
  - a stale form can't record an unconfirmed overpayment (another payment was recorded while it was open), and the confirmed retry succeeds
  - recording on a cancelled order is refused, and a rider is refused
  - two submissions with the same request ID create one payment
  - only owners can void, a reason is required, and the voided payment stops counting
  - void and replace happens in one transaction, with `replacesPaymentId` set and an audit event written
  - a retried void and replace with the same request ID returns the same replacement and creates nothing new, and a retried void-only returns success
  - when the replacement payment fails to save, the original payment stays confirmed and nothing else changes
  - recording and voiding are refused when the store can't work on existing orders
  - the database refuses a second replacement for the same voided payment
  - a Paystack payment can't be voided, and two voids at once: exactly one succeeds
  - a FreshFold user cannot record or void a payment on a CleanWave order, even by sending its ID
  - staff see no totals on the Payments page, and owners see the correct store and online split
  - the Payments page uses a fixed number of queries per page
  - the Payments page never lists pending or failed payments, and sorts and filters by when payments were confirmed
  - the database refuses a store-collected payment with the Paystack method
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** at ~360px and desktop, light and dark:
  - as staff, record a part payment, then the rest, and see the badge go from Outstanding to Paid
  - record more than the balance and see the confirmation and Refund owed
  - as owner, void a payment with a reason, then void and replace another
  - check the Payments page as staff (no totals) and as owner (totals)
- **Next.js DevTools:** no runtime or build errors on `/orders/[id]` and `/payments`
- **Neon MCP** (`development`, read-only): payments, voids, replacements, and audit events match each step, and amounts are whole kobo

## References

- @context/project-overview.md (Payments, Payment states, Staff accounts and roles)
- @context/coding-standards.md (Money, Database: transactions and append-only history)
- @context/features/10-orders-list-and-detail-spec.md (`getBalance`, payments section)
- @context/features/12-quotes-and-revisions-spec.md (timeline helper)
- @context/features/09-staff-order-entry-spec.md (request ID pattern)
