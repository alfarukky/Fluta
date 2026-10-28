# Feature 18 — Refunds

## Overview

When a store owes a customer money back (a cancelled paid order, an overpayment, or a price lowered after payment), the store pays it back **outside Fluta** (cash, bank transfer, POS) and staff **record the refund** here. Owners can void a refund recorded by mistake and record the correct one. Every refund shows straight away in the order's payment state through `getBalance`.

It follows Feature 16's patterns closely: request IDs against double submits, the server deciding amounts from the current balance, void and replace in one transaction, and audit entries.

## Requirements

### Access

- Owners and staff can record refunds (`requireStoreMember()`). Riders cannot
- Only owners can void refunds
- Recording and voiding both require the store's existing-orders capability from `getStoreAccess`. When the store can't work on existing orders, neither is allowed
- The store comes only from the membership. An order or refund from another store returns "Order not found" or is refused
- Every action returns the app's built shape, `{ ok, message, fieldErrors? }`

### When a refund can be recorded

- Only when the order **owes the customer money**: `getBalance` shows **Refund owed**. Otherwise the action isn't offered, and the server refuses it
- **Eligibility depends only on the current `getBalance` result and the store's access, never on the order's stage.** So refunds work on any stage, including Cancelled and Completed (a cancelled paid order is the most common case, but an overpaid or re-priced completed order counts too)
- **The limit:** the most that can be refunded is `max(0, −balance)`, using `getBalance`'s current balance, with refunds already paid counted in. For example, a ₦10,000 total, ₦15,000 paid, and ₦2,000 already refunded leaves ₦3,000 refundable
- **Never more than is owed.** If the refund is more than that limit (for example someone else recorded a refund while the form was open), nothing is saved and the form shows: "The amount owed has changed. ₦X is now owed." Part refunds are allowed
- **Fees never reduce what's owed to the customer.** Amounts owed and refund limits use what the **customer paid**, not what the store received after Paystack's or Fluta's fees. Fluta's retained fee is kept separately and never appears as a refund

### Two refunds at the same moment

- Recording a refund, and void and replace, first **lock that order's row** inside the transaction, then work out the amount owed, check the refund against it, and save. Simultaneous refunds for the same order queue up: the second sees the updated amount and is refused if it's now too much
- Refunds for different orders never wait on each other

### Recording a refund

- **Record refund** on the order detail page. It is the primary action whenever the order shows Refund owed
- Fields:
  - **Amount:** entered with `parseNairaToKobo`, more than ₦0, pre-filled with the amount owed
  - **How it was paid back:** Cash, Bank transfer, POS, or Other
  - **Reference:** optional, up to 100 characters (for example a transfer reference)
  - **Note:** required, up to 200 characters (for example "Order cancelled, refunded by transfer")
- Saved as a `Refund` with `paidAt` now and `recordedByUserId`. The date is when it is recorded. No backdating
- The form sends a UUID request ID created when it opens. Recording twice with the same ID returns the same refund
- **Refunds never change payments.** A payment is never marked as refunded. Payments record money in, refunds record money out, and `getBalance` combines them
- Save is disabled while saving

### Online payments

- A refund for money that came in through Paystack is still paid back by the store outside Fluta, and recorded here like any other refund. Fluta does not use Paystack's refund feature in the MVP (Paystack plan decision 12)
- **Fluta's fee is not returned.** When an online payment had a Fluta fee above 0%, Fluta keeps it, and the refund covers only what the store pays back. The order detail page says so beside online payments that had a fee: "Fluta's fee on this payment isn't refunded"

### Voiding a refund (owners only)

Exactly like voiding a payment in Feature 16:

- **Void refund** on a refund, with a required reason (up to 200 characters)
- **Void only**, or **Void and record correct refund** in one transaction, with the replacement linked by `replacesRefundId`
- Each void writes an `AuditEvent` with who, when, the reason, the original refund, and the replacement if any
- A voided refund stays in the history, shown struck through, and never counts in any total
- Only a refund that isn't already voided can be voided, in one conditional update, so two owners voiding at once can't both succeed
- **Retries are safe:** void and replace sends its own request ID, saved as the replacement's `clientRequestId`, so a retry returns the same replacement. A retried "Void only" by the owner who voided it returns success
- The replacement is checked against the amount owed **after** the void, using the same rule as recording
- Refunds are never edited or deleted
- Void reasons and audit details are staff-only

### Schema changes (Ask First)

One migration:

- `Refund.method` (Cash, Bank transfer, POS, or Other, reusing the existing method values without Paystack), `Refund.reference` (`String?`), and `Refund.clientRequestId` (**required**, `String`) with `@@unique([storeId, clientRequestId])`. It is required because every refund is recorded by a person (development and staging have no refund rows after the 17b reset)
- `Refund.replacesRefundId` becomes unique, so a voided refund has at most one replacement
- Database checks: the amount is above 0, the method is never Paystack, and a voided refund has its void time, who voided it, and the reason, while one that isn't voided has none of them

### Order detail page

- A **Refunds** list in the payments section: amount, how it was paid back, reference, note, date, who recorded it, and voided ones struck through
- Record refund and, for owners, Void refund
- Each recorded or voided refund appears in the staff timeline as its own entry (for example "Refund recorded: ₦3,000 by transfer, by Ada"), never as a stage change

### Customer tracking page

- Once a refund is recorded, the payment section shows "Refunded: ₦X" under the payments, using customer wording. X is the **total of active refunds**, never individual entries
- When nothing more is owed, the payment state follows `getBalance` as usual (for example Nothing due on a cancelled order)
- The tracking link already stays valid while a refund is owed (Feature 14). After the refund is fully recorded, the usual 30-day expiry applies again
- Void reasons, notes, and references are never shown to the customer

### Payments page

- A **Refunds** view beside payments, with the same date filter (calendar days in the store's time zone) and the same "Load more"
- It lists refunds that aren't voided and voided ones (struck through), sorted by `paidAt`
- **Owners only:** the total of refunds paid in the period, counting only refunds that aren't voided. Labelled clearly, for example "Refunds paid today"

## Not in this feature

- Refunding through Paystack's refund API
- Customers requesting refunds themselves
- Refund messages to customers by SMS or email
- Cancellation fees (still an open product question)
- Backdating refunds

## Done when

- Unit tests: amount limits, the "more than owed" check against the current balance, and the customer wording "Refunded: ₦X"
- Integration tests:
  - recording a refund on a cancelled paid order moves it from Refund owed to Nothing due, and a part refund leaves the rest owed
  - a refund can't be recorded when nothing is owed, and a refund larger than what's owed is refused, including from a stale form
  - two submissions with the same request ID create one refund
  - **two different refunds for the same order at the same moment**, each for the full amount owed: exactly one succeeds, and the other is refused
  - a refund, then voiding it, then a smaller new refund leaves the right amount owed. Void and replace with a smaller amount counts only the replacement
  - a payment's status never changes when a refund is recorded, and an online payment's fees never reduce the amount owed
  - only owners can void, a reason is required, and a voided refund stops counting, so the order shows Refund owed again
  - void and replace happens in one transaction, a failed replacement leaves the original refund in place, and retries return the same result
  - the database refuses a second replacement, a Paystack method, a zero amount, and a voided refund missing its void details
  - riders are refused, and recording and voiding are refused when the store can't work on existing orders
  - a FreshFold user can't record or void a refund on a CleanWave order, even by sending its ID
  - the tracking page shows "Refunded: ₦X" and never shows notes, references, or void reasons
  - staff see the Refunds view without totals, and owners see a total that excludes voided refunds
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP**, at ~360px and desktop, light and dark:
  - cancel a paid order, see Refund owed, record a part refund then the rest, and see Nothing due
  - as owner, void a refund and see Refund owed return, then void and replace another
  - check the customer's tracking page and the Payments page's Refunds view, as staff and as owner
- **Next.js DevTools:** no runtime or build errors on `/orders/[id]`, `/payments`, and `/o/[token]`
- **Neon MCP** (`development`, read-only): refunds, voids, replacements, and audit events match each step

## References

- @context/project-overview.md (Payments, Payment states, Staff accounts and roles)
- @context/features/16-store-collected-payments-spec.md (the patterns this feature follows)
- @context/features/10-orders-list-and-detail-spec.md (`getBalance`)
- @context/features/14-guest-tracking-and-approvals-spec.md (link validity while a refund is owed)
- @context/docs/paystack-integration-plan.md (decision 12)
