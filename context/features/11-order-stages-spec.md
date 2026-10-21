# Feature 11 — Order Stages

## Overview

Staff move orders through their stages from the order detail page: received, in progress, ready, out for delivery, completed. They can also cancel an order and step back one stage to fix a mistake. Every move goes through one shared function, `canTransition`, which is the only place that decides whether a move is allowed. This is where Feature 10's order detail page stops being read-only.

## Requirements

### Access

- Owners and staff can change stages (`requireStoreMember()`), whenever the store may work on existing orders. The store comes only from the membership, and an order from another store returns "Order not found"
- Owner-only moves (reopening a completed order) check the role on the server, never only in the UI

### `canTransition` (the only source of truth)

- One pure function in `src/server/domain/` (`canTransition(from, to, context)`) returns allowed or denied with a plain-language reason. It has no database access: the caller passes everything it needs
- The context includes: fulfilment type, the user's role, whether the order has an approved quote, whether a revision is waiting for customer approval, the note (if any), the order's starting stage, for reopening the stage it was completed from, and `collectedByCustomer`
- For a pickup order, Ready → Completed is allowed only with `collectedByCustomer = true` and a note. Drop-off orders don't need it, because their completion from Ready always means the customer collected
- It follows the overview's "Allowed transitions" table exactly. The moves this feature makes available:

| From | To | Condition |
| --- | --- | --- |
| Booked | Received by store | Drop-off order |
| Pickup scheduled | Picked up | Pickup order |
| Picked up | Received by store | Pickup order |
| Received by store | In progress | The order has an approved quote and nothing waiting for approval |
| In progress | Ready | None |
| Ready | Out for delivery | Pickup order |
| Ready | Completed | Drop-off order, nothing waiting for approval |
| Ready | Completed ("Customer collected instead") | Pickup order collected in person, note required, nothing waiting for approval |
| Out for delivery | Completed | Nothing waiting for approval |
| Any open stage | Cancelled | Note required for staff, optional for owners |
| Any stage except Booked, Completed, Cancelled, and Quote awaiting approval | The previous stage | Note required, one step only |
| Completed | The previous stage | **Owners only**, note required |

- **Cancelling** is also available from Quote awaiting approval (for example after a customer declines). Every other move into or out of that stage belongs to Feature 12
- Moves into and out of **Quote awaiting approval** (except cancelling), and **Booked → Pickup scheduled** for online bookings, are not offered here. `canTransition` still knows these rules so later features reuse it (Features 12, 13, and 14)
- One helper (for example `getAvailableTransitions`) lists the allowed next moves for an order, using `canTransition`. The page only shows what it returns
- The stage-change action accepts only the moves in this feature's table, even if called directly. Later features add their own actions, reusing `canTransition` rather than duplicating its rules

### Making a move (one transaction)

All of these happen together, or none do:

1. Re-check the move with `canTransition` on the server, using the order as it is in the database now
2. Update the stage **only if it is still the stage the user saw** (a single conditional update). If someone else changed the order first, nothing is saved and the user sees "This order was just updated. Refresh to see the latest." This prevents two staff members applying conflicting moves at the same moment
3. Set `completedAt` when moving to Completed, and clear it when an owner reopens a completed order. Set `cancelledAt` and `cancelNote` when cancelling
4. Write a `StatusEvent` with the old stage, new stage, actor (STAFF, with the user), and note

- **Step back uses a fixed previous stage, never the latest event** (so pressing it twice goes back two stages and never bounces between two):

| Current stage | Step back to |
| --- | --- |
| Pickup scheduled | Booked |
| Picked up | Pickup scheduled |
| Received by store | Booked (drop-off) or Picked up (pickup) |
| In progress | Received by store |
| Ready | In progress |
| Out for delivery | Ready |

- Step back isn't offered on the order's **starting stage** (the first entry in its timeline). So a counter order can't step back from Received by store, and a staff-entered pickup can't step back from Pickup scheduled
- **Reopening a completed order** (owners only) returns it to the stage it was completed from, taken from the event that completed it (Ready, or Out for delivery)
- The timeline labels a pickup order's Ready → Completed event as "Completed: collected by customer", worked out from the event itself (no extra field), because a pickup order otherwise completes from Out for delivery
- Cancelling keeps the order, its lines, revisions, payments, and history. The order's payment badge then follows `getBalance` (anything collected shows as Refund owed, otherwise Nothing due)
- Cancelled is final. A cancelled order offers no moves
- No SMS is queued yet. "Ready" and "Out for delivery" messages are added in Feature 15

### Order detail page

- The header shows **one primary button** for the main next move. Other allowed moves sit in a quiet secondary menu. Labels are fixed:

| Order at | Primary button | Secondary menu |
| --- | --- | --- |
| Drop-off, Booked | Mark received | Cancel order |
| Pickup, Pickup scheduled | Mark picked up | Step back, Cancel order |
| Pickup, Picked up | Mark received | Step back, Cancel order |
| Received by store | Start work | Step back, Cancel order |
| In progress | Mark ready | Step back, Cancel order |
| Drop-off, Ready | Mark collected | Step back, Cancel order |
| Pickup, Ready | Out for delivery | Customer collected instead (note required), Step back, Cancel order |
| Pickup, Out for delivery | Mark delivered | Step back, Cancel order |
| Completed | None | Reopen order (owners only) |

- A menu item only appears when `canTransition` allows it for this order (for example, Step back never appears on a Booked order)
- When the main move isn't allowed, the page says why in plain language (for example "Waiting for the quote to be approved" for an unpriced order)
- Moves that need a note open a small dialog with the note field. Cancelling asks for confirmation, because it is final
- After a move, the page shows the new stage, the updated timeline, and a success toast. A failed move shows its reason as an error toast
- Save buttons are disabled while saving

## Not in this feature

- Weighing, priced quotes, revisions, and anything involving Quote awaiting approval (Feature 12)
- Confirming or proposing pickup windows for online bookings (Features 13 and 14)
- SMS and WhatsApp messages on stage changes (Feature 15)
- Payments and refunds (Features 16 to 18)
- Moving several orders at once from the list
- Editing an order's address

## Done when

- Unit tests: `canTransition` for **every** from and to stage, for both fulfilment types and both roles, including notes required, owner-only reopening, cancelled being final, and moves blocked by a missing approved quote or a revision waiting for approval
- Unit tests: cancelling from Quote awaiting approval is allowed, and no other move from that stage is offered
- Unit tests: a pickup order's Ready → Completed ("Customer collected instead") is refused without `collectedByCustomer`, refused with it but no note, and allowed with both
- Integration tests:
  - every allowed move updates the stage, writes one status event with the right actor and note, and sets or clears `completedAt` and `cancelledAt` correctly
  - a staff member cannot reopen a completed order, even by calling the action directly
  - calling the action directly with a move this feature doesn't own (for example Booked → Pickup scheduled) is refused
  - an owner reopens a completed order: `completedAt` is cleared, the original Completed event is kept, and completing it again sets a new `completedAt`
  - two conflicting moves sent at the same time: exactly one succeeds, and the other gets the "just updated" message
  - pressing step back twice goes back two stages, never bouncing between two
  - a counter order offers no step back at Received by store, and a staff-entered pickup offers none at Pickup scheduled
  - reopening a "Customer collected instead" order returns it to Ready, and a delivered one to Out for delivery
  - a FreshFold user cannot move a CleanWave order, even by sending its ID
  - cancelling a paid order shows Refund owed, and cancelling an unpaid one shows Nothing due
  - an order in Quote awaiting approval can be cancelled, and offers no other move
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as staff at ~360px and desktop, light and dark:
  - take a drop-off order from Booked to Completed, and a pickup order from Pickup scheduled to Completed
  - use "Customer collected instead" with a note, and step back with a note
  - cancel with confirmation
  - see the reason when an unpriced order can't start work
  - as owner, reopen a completed order
- **Next.js DevTools:** no runtime or build errors on `/orders/[id]`
- **Neon MCP** (`development`, read-only): stages, status events, `completedAt`, and `cancelledAt` match each move

## References

- @context/project-overview.md (Order stages, Allowed transitions, Edge-case rules)
- @context/coding-standards.md (Module Boundaries: one function per rule, Database: transactions)
- @context/features/10-orders-list-and-detail-spec.md (order detail page, `getBalance`)
