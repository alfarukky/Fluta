# Feature 14b — Deliveries View and Rider Role

## Overview

The store's own riders get a simple, phone-friendly **Deliveries** view: today's pickups and deliveries, each with the customer's name, a Call button, the address, and one big button for the next step. Riders have a new, limited **Rider** role: they can use the Deliveries view and nothing else. Owners and staff can use the Deliveries view too.

It reuses Feature 11's `canTransition`, Feature 08's invitations, and Feature 03's access helpers. Riders are invited and deactivated like staff.

## Requirements

### Schema change (Ask First)

- Add `RIDER` to `StoreRole` in one migration. Existing memberships are unchanged

### Inviting a rider (updates Feature 08)

- The invite form in Settings → Staff gets a role choice: **Staff** or **Rider**. Owners are still invited only by Fluta admins
- Everything else about invitations is unchanged: email-bound, single use, 7 days, Resend and Revoke, the one-membership rule, and deactivation signing the person out
- The staff list shows each person's role, including Rider. The page heading becomes **Team** (the address stays `/settings/staff`)
- The invitation page states the role: "You've been invited to join {store name} as a Rider" (or "as Staff")

### Access: deny riders by default

- `requireStoreMember()` with no role option now allows **Owner and Staff only**. Every existing workspace page, action, and API route therefore refuses riders without any change to its own code
- Only the Deliveries page and its actions opt in to riders explicitly
- A rider opening any other workspace address gets the no-access page. A rider calling any other action or API route directly is refused
- After signing in, one helper decides where each person lands: riders to `/deliveries`, owners and staff to `/overview`, Fluta admins to `/admin`. No other code decides this
- The rider's menu shows only **Deliveries**. Owners' and staff's menus gain **Deliveries** too, using the single navigation config from Feature 04

### The Deliveries view (`/deliveries`)

Three sections, in this order, for the user's store only. "Today" is in the store's time zone.

1. **Pickups:** pickup orders at Pickup scheduled for today or earlier (earlier ones marked **Overdue**), sorted by window start
2. **On the way:** pickup orders at Out for delivery
3. **Ready to deliver:** pickup orders at Ready

- Every section contains only pickup and delivery orders (`fulfilmentType = PICKUP_DELIVERY`), checked in the query itself. Drop-off orders never appear
- Once an order is marked picked up, it **leaves the Deliveries view** until it reaches Ready. This is by design

Each card shows only what the job needs:

- Order number (`formatOrderNumber`) and the customer's name. For riders the order number is plain text. For owners and staff it links to the order page
- **Call** (a `tel:` link to the customer's phone)
- The address and the order's area copy (`serviceAreaName`), marked "Outside our service areas" when out of area
- **Pickup cards only:** the scheduled date and window in 12-hour format, with an "Outside normal schedule" badge when set. Delivery cards (On the way, Ready to deliver) show no time, because the MVP promises no delivery time
- One big button for the next step

Riders never see prices, totals, payments, revisions, internal notes, the customer's note, or order history. **One data function** builds the cards and returns only the fields above (order ID, number, customer name and phone, address, area copy, scheduled date and window, outside-schedule flag, and stage). Full orders never reach the page.

Empty state: "No pickups or deliveries right now." Desktop: a simple list. Mobile: stacked cards with buttons at least 44 pixels tall.

### Moves

| Card | Button | Move |
| --- | --- | --- |
| Pickup | Mark picked up | Pickup scheduled → Picked up |
| Ready to deliver | Out for delivery | Ready → Out for delivery |
| On the way | Mark delivered | Out for delivery → Completed |

- **Three dedicated actions,** one per button ("mark picked up", "out for delivery", "mark delivered"), never the general stage-change action from Feature 11. Each action:
  1. checks the user and an active membership with the Rider, Staff, or Owner role, with the store from the membership
  2. loads the order for that store and checks it is a pickup order at the **exact stage** this button expects
  3. still calls `canTransition` (whose context now includes the Rider role), so Feature 11 stays the single source of stage rules
  4. applies the conditional update and writes the status event
- **An allowlist:** riders can make only these three moves. Any stage move added in the future is not available to riders unless it is deliberately added to these actions, with tests. Step back, cancel, reopen, and "Customer collected instead" stay refused for riders, on the server
- Each button is disabled and shows "Saving…" while its move is being saved, as in Feature 11
- The same conditional update as Feature 11: if the order changed since the page loaded, nothing is saved and the rider sees "This order was just updated. Refresh to see the latest."
- When a move isn't allowed (for example a price update is still waiting for the customer before delivery can be completed), the card shows the plain reason and "Contact the store"
- Each move writes a `StatusEvent` with the rider as the actor (actor type STAFF, with their user), so the staff timeline shows who did it
- The actions accept only orders that belong to the user's store and are currently in the right stage for that button. Anything else is refused

## Not in this feature

- Routes, maps, rider tracking, or assigning orders to particular riders
- Riders who are not store employees, or per-delivery links without an account
- Proof of delivery (photos, signatures)
- Delivery dates or promised times
- SMS when an order goes out for delivery (Feature 15)

## Done when

- Unit tests: `canTransition` for the Rider role (the three moves allowed, every other move refused), the Deliveries sections and ordering (overdue first, then by window), and "today" in the store's time zone
- Integration tests:
  - a rider can open `/deliveries` and make the three moves, each writing a status event with the rider as actor
  - a rider is refused on every other workspace page, action, and API route, including the orders list, an order detail page, settings, and services
  - a rider calling Feature 11's general stage-change action is refused, and the three delivery actions refuse any order not at the exact expected stage
  - no move other than the three allowlisted ones is available to riders, so a future stage move can't become rider-accessible by accident
  - the Deliveries data function returns only the listed fields
  - drop-off orders never appear, and a picked-up order leaves the view until it is Ready
  - the Deliveries data for a rider contains no prices, totals, payments, notes, or history
  - a FreshFold rider sees no CleanWave orders and cannot move one, even by sending its ID
  - an owner can invite a rider, the invitation page says "as a Rider", the rider accepts and lands on `/deliveries`, and deactivating the rider signs them out
  - two people moving the same order at the same moment: exactly one succeeds
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** at ~360px and desktop, light and dark:
  - as owner, invite a rider and accept the invite in a private window
  - as the rider, see only Deliveries, mark a pickup collected, take a ready order out for delivery, and mark it delivered
  - as the rider, try opening `/orders` and `/settings` and see the no-access page
  - as staff, see the rider's moves in the order timeline
- **Next.js DevTools:** no runtime or build errors on `/deliveries`
- **Neon MCP** (`development`, read-only): the rider's membership has role `RIDER`, and status events show the rider as actor

## References

- @context/project-overview.md (Staff accounts and roles, Order stages, Fulfilment)
- @context/coding-standards.md (Security: authorization on every request)
- @context/features/03-auth-access-spec.md (`requireStoreMember`)
- @context/features/04-workspace-shell-spec.md (navigation config)
- @context/features/08-staff-management-spec.md (invitations)
- @context/features/11-order-stages-spec.md (`canTransition`, conditional updates)
