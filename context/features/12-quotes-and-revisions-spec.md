# Feature 12 — Quotes and Revisions

## Overview

Staff price orders that couldn't be priced at creation (weighing per-kg laundry, inspecting quote-required items, setting a quoted pickup charge), and change the price of any order later (extra items, stains, a lower actual weight, a discount). Every price change becomes a new **quote revision** that the customer must approve. This feature builds the staff side: issuing quotes and revisions, and recording an approval or decline the customer gives in person or by phone. Customers approving through their private link comes in Feature 14.

It reuses Feature 09's pricing rules (`isOrderFullyPriced`, server-built prices, per-kg rounding), Feature 10's `getBalance`, and Feature 11's `canTransition`.

## Requirements

### Access

- Owners and staff have the same permissions here (`requireStoreMember()`), whenever the store may work on existing orders. The store comes only from the membership, and an order from another store returns "Order not found"
- Revisions can be issued only up to **Ready**. They are not available while an order is Out for delivery, Completed, or Cancelled. Anything that comes up from delivery onwards is resolved outside Fluta

### How order lines and revisions relate

- **Order lines are the working copy.** They always show the latest issued revision, even one that was declined. They change only when a revision is issued
- **Revisions are the permanent record.** A revision is never edited, and its lines copy (`linesSnapshot`) never changes
- **Money only ever follows the approved revision.** `getBalance`, payments, and receipts use the approved revision, never the working lines or a pending revision. While a revision is pending or declined, the order summary marks the lines as **Proposed changes** next to the last approved total
- `linesSnapshot` holds enough to rebuild the quote without the catalogue: for each line its service ID (if any), name, pricing type, quote flag, quantity, unit price, and line total, plus the area name, the out-of-area flag, and the pickup and delivery charge

### Editing a quote

From the order detail page, **Edit quote** opens the order's lines for editing. Staff can:

- Enter or change the weight or quantity of any service line (for example weighing an unweighed per-kg line)
- Add service lines from active services (priced from today's catalogue, as in Feature 09) and remove service lines
- Add, change, or remove Others lines (extra charge or discount)
- Set or change the pickup and delivery charge, or change the area (including switching to or from out of area), following Feature 09's copy rules. A fixed area's charge comes from the area
- **Existing service lines keep their original unit price**, even if the catalogue changed. Only newly added lines use today's catalogue price
- The server builds every price, exactly as in Feature 09. The browser sends only IDs, quantities, adjustments, and the area choice
- A **reason** is required for every revision after the order's first approved quote. The field is labelled **"Visible to the customer"**. It is optional for the first priced quote, which is the first revision issued while the order has no approved quote
- A revision must be fully priced (`isOrderFullyPriced`) and its total may not be negative
- The edit screen shows the last approved total, the new total, and the difference
- If a revision is already waiting for approval, the edit screen warns: "This replaces the quote waiting for customer approval"

### Issuing a revision (one transaction)

All of these happen together, or none do:

1. Re-check access and that the order is still at a stage that allows revisions
2. Create the next **version** of `QuoteRevision` with status `PENDING`, its `linesSnapshot`, subtotal, charge, total, reason, and `createdByActor = STAFF` with the user. The database's unique rule on order and version means two revisions issued at the same moment can't both succeed. The other request gets "This order was just updated. Refresh to see the latest."
3. Any earlier revision still `PENDING` becomes `SUPERSEDED`, so at most one revision is ever pending
4. Update the order's working lines to match the new revision
5. Move the stage only for the **first priced quote**:
   - From Received by store, or from Booked for a pickup charge quote: move to **Quote awaiting approval** through `canTransition` (as a System move), with a `StatusEvent`
   - `stageBeforeQuote` is set to the stage it came from **only at this moment**. Later revisions never change it
   - Any revision of an order that already has an approved quote leaves the stage unchanged. The order shows **"Revised total awaiting approval"** and cannot be completed until it is approved or replaced (as `canTransition` already enforces)

### `canTransition` and the actor

- `canTransition`'s context gains the **actor type** (staff, customer, or system), so the move into Quote awaiting approval and the automatic return both go through it, never around it

### Approving and declining (shared logic)

- Approving and declining are **one shared server operation**, used by staff here and by customers through their link in Feature 14. Feature 14 must call it, never build a second version
- They are available only while a revision is `PENDING`. Approval or decline succeeds only if the revision is **still pending**, in one conditional update. So if staff and the customer approve at the same moment, exactly one succeeds. Acting on an outdated or already-decided revision is refused. Staff see "This order was just updated", and customers will see "This quote is no longer current" (Feature 14)

**Approving** (in one transaction):

- The revision becomes `APPROVED` with `approvedAt` and `approvedByActor`
- The previously approved revision becomes `SUPERSEDED`. An order always has at most one approved revision, and `approvedQuoteId` always points to it (or is empty if there is none)
- If the order is in Quote awaiting approval, it returns to **exactly** `stageBeforeQuote` (through `canTransition`, with a `StatusEvent`), and `stageBeforeQuote` is cleared. It never moves any further automatically

**Declining:**

- The revision becomes `DECLINED` with `declinedAt` and the customer's reason in `customerMessage`
- The order stays where it is, including staying in Quote awaiting approval, and `stageBeforeQuote` is kept. Staff then issue a new revision or cancel the order (Feature 11)

**Recording a decision given in person or by phone (staff):**

- **Record approval:** sets `approvedByActor = STAFF`. A note on how it was received (for example "Approved by phone, 2:15 PM") is required and stored in an `AuditEvent` with who recorded it
- **Record decline:** the customer's own reason is required and stored in `customerMessage`. A note on how it was received is stored in an `AuditEvent`
- The two are kept apart: `customerMessage` is what the customer said, and the audit note is how staff recorded it

### Effects on payment

- `getBalance` follows the approved revision automatically. A lower approved total on a paid order shows **Refund owed**. A higher one shows **Outstanding** for the difference. A pending revision never changes the balance. No payment logic is added here

### Editing the address

- **Edit address** on the order detail page, for pickup orders only, allowed up to Ready (for example a customer who moves before delivery). Not a price change, so no revision
- Each change writes a new `AuditEvent` with the old and new address. Address audit data is staff-only and never appears in anything customer-facing

### Order detail page

- **Edit quote** among the secondary actions, and as the primary action when the order is waiting to be priced ("Price order" on an unpriced order at Received by store)
- A clear banner while a revision is pending: "Quote awaiting customer approval" or "Revised total awaiting approval", showing the old total, new total, difference, and reason, with **Record approval** and **Record decline**
- After a decline, the banner reads **"Customer declined: {their reason}"** with **Edit quote** and **Cancel order**, and no approval actions
- Quote history (from Feature 10) shows every revision with its status, including Superseded and Declined, and the customer's message on declined ones
- **One timeline:** a helper in the data layer builds the order's timeline from stage events and revision moments (issued at `createdAt`, approved at `approvedAt`, declined at `declinedAt`), sorted by time. The page doesn't merge lists itself. Revision entries read, for example, "Quote v2 issued: ₦12,500 (+₦2,500). Reason: Actual weight 4.2 kg", "Quote v2 approved by customer (recorded by Ada)", or "Quote v3 declined: Too expensive"
  - Revision entries have a **soft tinted background** from a theme token at low strength (for example the info colour at about 10%), which adjusts for light and dark themes. Stage entries keep the plain background
  - Each revision entry also has an icon and clear wording, so it stands out without relying on colour alone

## Not in this feature

- Customers viewing, approving, or declining quotes through their private link (Feature 14)
- SMS when a quote needs approval (Feature 15)
- Recording payments, refunds, or collecting the extra amount owed (Features 16 to 18)
- Re-pricing existing lines to today's catalogue price
- Revisions while an order is Out for delivery

## Done when

- Unit tests: revision totals from server-built lines (including existing lines keeping their original price), the difference shown, the reason rule, and negative totals refused
- Integration tests:
  - weighing an unweighed per-kg order and issuing the first priced quote moves it to Quote awaiting approval with `stageBeforeQuote` saved, and recording approval returns it there exactly, clears `stageBeforeQuote`, and sets `approvedQuoteId`
  - a later revision never changes `stageBeforeQuote`
  - a revision after work has started leaves the stage unchanged, blocks completion until approved, and recording approval updates the balance
  - an unpaid order's balance stays on the approved total while a higher revision is pending, and changes only once it is approved
  - a lower approved total on a paid order shows Refund owed, and a higher one shows Outstanding
  - issuing a new revision supersedes the pending one, and the old one can no longer be approved
  - two revisions issued at the same moment: one succeeds, the other gets the "just updated" message, and version numbers stay unique
  - two approvals of the same revision at the same moment: exactly one succeeds, and the order has one approved revision
  - recording a decline stores the customer's reason and the audit note separately, keeps the order where it is, and a new revision can follow
  - revisions are refused once an order is Out for delivery
  - a request that sends its own unit price or charge is ignored
  - a FreshFold user cannot revise or approve a CleanWave order, even by sending its ID
  - editing the address writes an audit event, works only for pickup orders, and is refused once the order is Out for delivery
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as staff at ~360px and desktop, light and dark:
  - weigh an unweighed per-kg order, issue the quote, record approval, and see the order return to Received by store and then start work
  - add an extra item during In progress, see "Revised total awaiting approval" and "Proposed changes", and record approval
  - lower a paid order's total and see Refund owed
  - record a decline, see "Customer declined", then issue a new revision
  - see Edit quote unavailable on an order that is Out for delivery
  - edit an address on a pickup order
  - see revision entries in the timeline with the soft tint, in both light and dark themes
- **Next.js DevTools:** no runtime or build errors on `/orders/[id]` and the quote editing screen
- **Neon MCP** (`development`, read-only): revision versions, statuses, `approvedQuoteId`, `stageBeforeQuote`, and audit events match each step

## References

- @context/project-overview.md (Quotes and revisions, Order stages and Allowed transitions, Payments, Data Model → `QuoteRevision`, `OrderLine`)
- @context/coding-standards.md (Database: transactions, append-only history)
- @context/features/09-staff-order-entry-spec.md (pricing rules, `isOrderFullyPriced`)
- @context/features/10-orders-list-and-detail-spec.md (`getBalance`, quote history)
- @context/features/11-order-stages-spec.md (`canTransition`, conditional updates)
