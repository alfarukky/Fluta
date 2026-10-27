# Feature 17b — Remove Per-kg Pricing, and Staff Notifications

## Overview

Two separate changes in one feature, built in order as **Part A** then **Part B**, each with its own commit and its own checks passing before the next begins.

- **Part A** removes per-kg pricing completely. Nigerian laundries price per item or per package, so Fluta keeps only those two. "Quote required" items (priced on inspection) stay.
- **Part B** makes the bell in the workspace top bar work: owners and staff see new online orders, customer decisions, and confirmed online payments as they happen.

# Part A — Remove per-kg pricing

## What stays

- Two pricing types: **per item** and **per package**
- **Quote required** for items priced on inspection (for example a wedding gown, or "Price on inspection" at ₦0), including staff setting their unit price when pricing (the unit-price fix)
  - Both kinds of quote-required catalogue price stay valid (Feature 06's rule): a price above ₦0 is a **starting price** ("from ₦5,000"), and ₦0 means **"Price on inspection"**
  - A quote-required service may have a catalogue price of ₦0. When staff price it, the unit price they enter is stored on that revision's line. The catalogue price never changes. The line total is always the quoted unit price × quantity, worked out by the server, never a total typed by staff
- The customer's **estimated count** for quote-required items at booking, never billed
  - It is information only. Staff set the real quantity when pricing, which may be higher or lower than the estimate (for example estimated 3, priced as 2 × ₦5,000)
- Revisions, approvals, `getBalance`, payments, and everything else unchanged

## What goes

Everything that exists only for per-kg pricing:

- `PER_KG` from the `PricingType` enum
- The database rules that a per-kg service and a per-kg order line always require a quote
- Weighing: weight fields, "To be weighed", "Your estimate. The store will weigh it.", estimated **weight**, and kg labels anywhere
- The per-kg rounding helper in `money.ts` (whole-number weight × price). Line totals become unit price × whole quantity everywhere
- Per-kg branches in: the service form and catalogue (Feature 06), staff order entry (09), the order detail page (10), quote editing (12), customer booking and its estimated total rule (13 and 13b), the tracking page (14), and the design system samples
- "Laundry by weight" from the seed and the overview's sample data

## Quantities

- Every service line's quantity is a **whole number from 1 to 999**, for both pricing types, checked by the server
- `OrderLine.quantity` and `estimatedQuantity` keep their current database type, so no column changes. The app only ever accepts whole numbers
- The migration also adds a database check that both are whole numbers when set, as a last safety net

## Migration (Ask First)

One migration that:

1. **Checks first, before changing anything:** if any `Service` or `OrderLine` still uses `PER_KG`, it stops with a clear error naming the counts. It never deletes or converts data itself
2. Removes the per-kg database rules
3. Removes `PER_KG` from `PricingType` (on PostgreSQL this usually means creating a new enum type, switching the columns to it, and dropping the old one)

- The whole migration is **all or nothing**: confirm how Prisma applies it on PostgreSQL, and wrap it in one transaction explicitly if needed, so a failure at any step changes nothing
- The safety check stays even though development and staging are reset, because it will protect production's real data in future

## Existing data: a clean reset

Everything in development and staging is test data, so both are **reset**, leaving only what's needed to sign in.

**The minimal seed** (for development and staging):

- The two stores, FreshFold and CleanWave
- Each store's **owner account**, with the `SEED_USER_PASSWORD`
- An **active subscription** for each store (without one, a store counts as suspended and can't take new orders)
- **Nothing else:** no services, service areas, customers, orders, payments, staff, or riders. These are created through the app

**The test database keeps its own data.** The integration tests must not depend on the minimal seed. They create what they need in their own setup, or use a separate full test seed, including per-item, per-package, and quote-required services. Every existing test must still pass.

**The reset:**

1. **Development:** a full reset (`prisma migrate reset`), which empties the database, applies every migration including this one, and runs the minimal seed
2. **Staging:** the same reset, run deliberately, following the staging seed steps (`ALLOW_STAGING_SEED=true`, then remove it), then redeploy
3. Afterwards, reconnect FreshFold to Paystack once in test mode (Paystack allows 3 bank checks a day)
4. A store's booking page shows "isn't taking online bookings" until its owner adds a service. That's expected

## Documents to update

- `context/project-overview.md`: the service catalogue (two pricing types, no weighing), the estimated quantity rules (counts only), the order line rules, the receipt example (no kg line), the sample data, and the schema (`PricingType`, the per-kg CHECK comments)
- `context/coding-standards.md`: remove the per-kg rounding rule from Money
- Earlier feature specs are history and stay as written. Add a note to `current-feature.md` that per-kg was removed in 17b

## Part A done when

- No active file references per-kg pricing: schema, code, seeds, tests, design system, the overview, coding standards, and `CLAUDE.md`. The migration itself is the only exception in code
- Historical feature specifications keep their per-kg wording, because they record what was built at the time
- The migration stops with a clear error on a database with per-kg rows, and **nothing is changed** (tested). It succeeds on a clean one
- Development and staging are reset with the minimal seed (stores, owners, subscriptions only), and FreshFold is reconnected in test mode
- The integration tests use their own data, independent of the minimal seed, and all pass
- Creating, booking, pricing, and paying for per-item, per-package, and quote-required items all still work
- A fractional quantity (for example `1.5`) is refused when sent **directly** to every action that takes one: staff order entry, customer booking, and quote editing, not only through the forms. The database refuses one too
- Lint, typecheck, unit tests, integration tests, and build pass

# Part B — Staff notifications (the bell)

## What creates a notification

Each is saved in the **same transaction** as the event that causes it, so a notification can never exist without its event, or be lost:

| Event | Who sees it | Created in |
| --- | --- | --- |
| A new **online booking** | Owners and staff | Feature 13's order creation (channel Online) |
| A customer **approves** a price update | Owners and staff | Feature 12's shared operation, only when the actor is the customer |
| A customer **declines** a price update | Owners and staff | Same, only when the actor is the customer |
| A customer **accepts** a suggested pickup time | Owners and staff | Feature 14's accept action |
| An **online payment is confirmed** | Owners and staff | Feature 17's confirmation, once only (inside its conditional update) |
| A payment **needs review** (mismatch) | **Owners only** | Feature 17's mismatch handling |

- **Payment notifications** are created only when Feature 17's conditional update **actually changed** the payment (to confirmed, or into review). A repeated webhook or verify that changes nothing creates nothing
- **"Needs review"** means exactly what the Paystack plan defines (section 6.8): a payment refused with one of its four mismatch codes. The notification is created once, when the payment enters that state
- **Never** for things staff do themselves: staff-entered orders, stage changes, staff-recorded approvals, store-collected payments
- Riders never see notifications

## Schema (Ask First)

- New model `Notification`: `id`, `storeId`, `orderId`, `type` (an enum of the six events above), `sourceId`, `audience` (`STAFF_AND_OWNERS` or `OWNERS_ONLY`), and `createdAt`
  - Linked to its order through `[storeId, orderId]`, like every other store-owned record, so a notification can never point at another store's order
  - `sourceId` records what caused it, with a unique rule on `[storeId, type, sourceId]`, so each event creates **at most one** notification even if an action or webhook is retried. Sources: the **order** (new online booking), the **revision** (approved or declined), the **status event** for the move to Pickup scheduled (pickup time accepted), and the **payment** (confirmed, or needs review)
  - Index on `[storeId, createdAt]`
  - Orders are never deleted, so notifications keep their link. The relation must never cascade-delete notifications
- `Membership.notificationsSeenAt` (`DateTime?`): when this person last opened the bell

## Read and unread

- Kept **per person**, using their own `notificationsSeenAt`
- **Unread** = notifications for their store and their role's audience, created after their `notificationsSeenAt` (or, if it's empty, after their membership was created), within the last 30 days
- **Opening the bell, safely:** in one step, the server takes a single "now" time **from the database**, saves it as this person's `notificationsSeenAt`, and lists only notifications created up to that moment. A notification arriving a split second later stays unread. If loading fails, nothing is marked seen
- Who sees what follows the person's **current** role: someone promoted to owner sees existing owner-only notifications. Deactivation doesn't reset `notificationsSeenAt`, so a reactivated member sees whatever is still within the 30 days

## The bell

- In the workspace top bar for owners and staff. A small count badge when there are unread notifications ("9+" above 9), with the count also announced to screen readers
- Opening it shows the newest 20 notifications, each with a short line and the time (12-hour, store time zone), linking to the order. Unread ones are marked. Examples:
  - "New online order FF-1024 from Musa"
  - "Musa approved the price update on FF-1024"
  - "Musa declined the price update on FF-1024"
  - "Musa accepted the pickup time for FF-1024"
  - "Online payment of ₦6,200 received for FF-1024"
  - "A payment on FF-1024 needs review"
- Each links to the order through the shared order-link helper, never a hand-built path
- Lines are built when shown, from the order's current data, as a deliberate trade-off: order numbers and customer names rarely change, so the text isn't stored. They never include a phone number or address
- The list shows read notifications too. Empty state, only when there are none in the last 30 days: "No notifications yet"

## Staying up to date

- While the workspace is open, the bell checks for new notifications **every 30 seconds** through one small, store-scoped request returning only the unread count
- The count request is as cheap as possible: one indexed count query, returning only a number, with no notification text or order data
- It pauses while the browser tab is hidden, and checks again as soon as the tab is visible
- If the person is signed out or loses access, checking stops
- No phone or browser push notifications, and no sounds

## Clean-up

- The existing scheduled job (Feature 15) deletes notifications older than 30 days

## Access and safety

- Every request (the count, the list, and marking seen) checks the session, an active membership, and the Owner or Staff role. Riders are refused at the requests themselves, not just hidden in the menu
- A person only ever sees their own store's notifications, and owner-only ones only if they are an owner

## Store isolation (no leaks between stores, ever)

- The store comes **only** from the person's membership, never from the request, a link, or a notification ID
- Every notification query filters by that store: the count, the list, marking seen, and the clean-up job
- A notification is always created with the **same store as its order**, enforced by the database link through `[storeId, orderId]`
- The unique rule on `[storeId, type, sourceId]` is per store, so one store's events can never block or replace another store's notifications
- Following a notification's link goes through the normal order page, which already returns "Order not found" for another store's order

## Part B done when

- Each of the six events creates exactly one notification in the same transaction, and a rolled-back event leaves none
- Staff actions create no notifications
- A repeated Paystack webhook or verify for the same payment creates no second "payment received" notification
- Staff never see "needs review" notifications, and riders see nothing
- Unread counts are per person: one staff member opening the bell doesn't clear another's
- **Store isolation:** with events happening in both FreshFold and CleanWave at the same time, each store's owners and staff see only their own store's notifications in the count and the list. Sending another store's notification or order ID to any request returns nothing from that store. The database refuses a notification whose store differs from its order's store
- Retrying the same event (an action, a webhook, or a verify) never creates a second notification, enforced by the unique source rule
- A notification created a split second after someone opens the bell stays unread for them
- Riders are refused by the count, list, and mark-seen requests themselves
- The bell updates within about 30 seconds of a new online booking without a page refresh, and pauses while the tab is hidden
- The scheduled job removes notifications older than 30 days
- Lint, typecheck, unit tests, integration tests, and build pass

## Verify with

- **Playwright MCP**, at ~360px and desktop, light and dark:
  - Part A: create per-item, per-package, and quote-required services, book them online, price a quote-required item, and pay. Confirm no kg wording appears anywhere
  - Part B: with the workspace open as staff, book online in another window and watch the bell's count appear. Approve a price update and accept a pickup time as the customer. Open the bell and confirm the count clears for that person only
- **Next.js DevTools:** no runtime or build errors
- **Neon MCP** (`development`, read-only): no `PER_KG` rows, and notifications match each event

## Not in this feature

- Phone or browser push notifications, sounds, and per-person notification settings
- Notifications for riders
- Marketplace orders (a later feature adds them as a new event)

## References

- @context/project-overview.md
- @context/coding-standards.md
- Features 06, 09, 10, 12, 13, 13b, 14, 15, and 17 specs, and @context/docs/paystack-integration-plan.md
