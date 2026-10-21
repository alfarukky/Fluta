# Feature 14 — Guest Tracking and Approvals

## Overview

Customers follow their order through a private link, `/o/{token}`, with no account: see where their order is, approve or decline a price update, and accept a pickup time the store suggests. Staff can confirm a customer's requested pickup time or suggest another, and get a fresh tracking link to share. The link is shown on the booking confirmation from Feature 13.

It reuses Feature 12's shared approve and decline operation, Feature 11's `canTransition`, Feature 10's `getBalance`, and Feature 13's customer layout and plain wording.

## Requirements

### The tracking link

- The token is 32 random bytes. Only its SHA-256 hash is stored (`Order.trackingTokenHash`). The raw token exists only in the link, and is never stored in the database, audit records, logs, or analytics
- **One helper, `getTrackingUrl(token)`,** builds every tracking link (`{BETTER_AUTH_URL}/o/{token}`): the booking confirmation, staff "Get tracking link", later SMS and WhatsApp messages, and tests. No component builds it by hand
- **Booking confirmation (Feature 13):** the order is created with a raw token, and the confirmation page shows the tracking link once, with Copy and "Save this link to follow your order"
- **Staff, "Get tracking link"** on the order detail page: issues a **fresh** token in one update (new hash and `trackingTokenIssuedAt`), so the old link stops working immediately, and shows the new link once with Copy. If two staff do this at the same moment, only the last stored link works
  - Offered only when the new link would be valid (see validity below). For example, not for an order closed more than 30 days ago with nothing owed
  - Writes an `AuditEvent` (tracking link issued, with the staff member), because a new link cuts off the customer's old one
  - SMS and the WhatsApp button come in Feature 15
- `trackingTokenIssuedAt` is information only. It never decides whether a link is valid

### Opening the link

- `/o/{token}` needs no sign-in. The server hashes the token and looks up exactly that hash. It loads that **one** order and its store, and nothing else is reachable from the link. No other lookup (by order number, phone, or part of a token) exists
- **Validity, checked in this order:**
  1. Store Deactivated: "This order is no longer available." (no store details)
  2. Order open: valid
  3. Completed or cancelled less than 30 days ago: valid
  4. Refund still owed (`getBalance` shows `REFUND_OWED`): valid, even after 30 days, until it is resolved
  5. Otherwise expired: "This link has expired. Please contact {store name}." with the store's phone as a Call link
- **Unknown token:** "This link isn't valid. Please check it, or contact the store." (HTTP 404)
- The page **and its actions** send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, are marked `noindex`, and the whole route is excluded from analytics
- The app's logger and any error reporting replace the token in `/o/…` paths with `/o/[token]`. The host's own request logs are checked at launch hardening (Feature 25)
- **Link previews** (for example when shared on WhatsApp) show only the store's name and "View your laundry order", never the customer's name, phone, order number, items, amounts, stage, or address

### What the tracking page shows

In the customer layout from Feature 13 (the store's branding, following the phone's light or dark setting), in plain words:

- Order number (`formatOrderNumber`) and the current stage, using customer wording:

| Stage | Customer sees |
| --- | --- |
| Booked | Booking received |
| Pickup scheduled | Pickup scheduled |
| Picked up | Picked up |
| Received by store | At the store |
| Quote awaiting approval | Waiting for your approval |
| In progress | Being cleaned |
| Ready (drop-off) | Ready for collection |
| Ready (pickup) | Ready |
| Out for delivery | On its way |
| Completed | Completed |
| Cancelled | Cancelled |

- **One shared customer timeline helper** (for example `getCustomerTimeline`) builds the progress shown (✓ done, ● current, ○ upcoming), using only the stages this order's type uses. The page doesn't work it out itself
  - While a price is waiting for approval, the timeline still shows the real progress from `stageBeforeQuote` (for example "Being cleaned" stays done), and "Waiting for your approval" appears as the action card. Customers never see their progress disappear
- Dates and times in 12-hour format, in the store's time zone. Staff names are never shown (entries say "The store")
- **Prices come only from the approved price** (the approved revision), never from the working lines or today's catalogue. Items show quantities or weights and prices, and the approved total is labelled "Total"
- **Before any price is approved:** the items, plus Feature 13's estimate rule. "Estimated total: ₦X" only when every part can be estimated, never labelled "Total". Otherwise "The store will confirm the price"
- **Payment state** from one shared mapping of `getBalance` states:

| `getBalance` state | Customer sees |
| --- | --- |
| Paid | Paid |
| Outstanding | Balance due: ₦X |
| Refund owed | The store will refund ₦X |
| Nothing due | Nothing due |
| Awaiting quote | The store will confirm the price |

- Pickup details: the order's own area copy (`serviceAreaName`), the date, and the time as "Requested", "Confirmed", or "Suggested by the store". **Never the full address**
- The phone number only masked, through the existing `phone.ts` helper. Never internal notes, the customer's own note (`customerNote`), or staff names
- **One action card** when something is waiting for the customer, calm but prominent:
  - "Price update ready for your approval" with **Review**
  - "The store suggested a new pickup time" with **Review**
- When the order is completed or cancelled, the page is view-only, and the server refuses every customer action

### Approving or declining a price (customer)

- The review screen shows: the previous approved total (if any), the new total, the difference made very obvious, the store's reason, the items with quantities or weights and prices, and the pickup and delivery charge
- **Approve** (primary) and **Decline or ask a question** (secondary). Technically both are Feature 12's approve and decline. "Decline or ask a question" is a decline with an optional message (up to 300 characters, saved as `customerMessage`), not a new state
- **Feature 14 contains no approval logic of its own.** It checks the token, then calls Feature 12's shared operation with the customer as the actor (`approvedByActor = CUSTOMER`)
- Approval succeeds only if the price update is still pending. If it was replaced or already decided: "This price update is no longer current." and the page shows the latest state
- **Approving never schedules a pickup.** The order returns to its earlier stage (`stageBeforeQuote`), and the pickup time is confirmed separately
- **Declining** changes nothing else: not the approved price, the balance, the stage, or the pickup time. Staff then send another price update or cancel
- Never uses the words "quote", "revision", or "version". It says "price update"

### Pickup times

**The lifecycle:** Requested (by the customer) → Suggested by the store (optional, can be replaced) → Confirmed

- The customer's original request stays recorded in the requested date and window. A suggestion is stored in the scheduled date and window

**Staff side**, on the order detail page of a pickup order whose time is Requested or Suggested:

- **Confirm requested time** (when Requested): sets the scheduled date and window to the requested ones, `pickupWindowStatus = CONFIRMED`, and moves the order from Booked to Pickup scheduled through `canTransition`, in one transaction
- **Suggest another time:** staff choose a date and window from `getPickupWindows`, or "Outside normal schedule" (any date and a custom start and end time, with a note, as in Feature 09). Saves them as the scheduled date and window with `pickupWindowStatus = PROPOSED_BY_STORE`. The order stays Booked
  - Each suggestion sets `isOutsideSchedule` for itself: on with its note when outside the schedule, off otherwise. Nothing carries over from a previous suggestion
  - Staff can replace a suggestion before the customer answers. Only the latest suggestion can be accepted
- Both are refused while a pickup charge is still waiting for the customer's approval, with a plain reason. If that price is declined, the pickup time stays as it was, and staff can send another price update
- Turning pickup off in the store's settings affects new orders only. Existing pickup orders can still be confirmed and scheduled

**Customer side**, when the store suggested a time:

- The card shows the suggested date and time, with **Accept** and **Contact the store** (a Call link to the store's phone)
- **Accept:** sets `pickupWindowStatus = CONFIRMED` and moves the order from Booked to Pickup scheduled through `canTransition` (actor CUSTOMER), in one transaction, only if the suggestion is still the current one

**Both sides:** every change re-checks the current state inside its transaction with a single conditional update, so a staff change and a customer action at the same moment can't both apply. The one that loses sees that the order was just updated.

### Access and safety

- Every customer action re-checks the token on the server and acts only on that token's order
- Customer actions are refused when the link is expired, the order is completed or cancelled, or the store is Deactivated
- The store comes from the order, never from the request
- Staff actions follow the workspace rules (`requireStoreMember()`, store from the membership)

## Not in this feature

- SMS, email copies, and the WhatsApp button (Feature 15)
- Paying online from the tracking page (Feature 17)
- The receipt page and "View receipt" (Feature 19)
- Customers cancelling or changing their order, or suggesting their own new pickup time
- Remembering past orders on the phone (Feature 22)

## Done when

- Unit tests:
  - link validity in its order (Deactivated, open, closed under 30 days, refund owed after 30 days, expired)
  - the customer stage wording, the payment wording mapping, and the customer timeline, including progress kept while a price awaits approval
  - `getTrackingUrl`
- Integration tests:
  - a token only ever opens its own order, and an unknown token returns 404
  - "Get tracking link" issues a new token, the old link stops working, an audit event is written, and two issued at the same moment leave only the last one working
  - "Get tracking link" isn't offered for an order whose link would already be expired
  - an expired link shows the expired message, and one with a refund owed still works
  - a customer approves a price update through Feature 12's operation, the order returns to `stageBeforeQuote` without scheduling a pickup, and a replaced update is refused as no longer current
  - a customer declines, and nothing changes except the decline and its message
  - a customer approval and a staff decision at the same moment: exactly one applies
  - staff confirm a requested pickup time and the order moves to Pickup scheduled
  - staff suggest a time, replace it, and the customer can accept only the latest. Accepting the older one is refused
  - `isOutsideSchedule` follows each suggestion and never carries over
  - pickup time changes are refused while a pickup charge awaits approval
  - the tracking page never contains the full address, full phone, internal note, customer note, or staff names
  - the tracking page and its actions carry the no-referrer, no-store, and noindex headers
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** at ~360px and desktop, light and dark:
  - book online, open the tracking link from the confirmation, and follow the order through stages as staff move it
  - as staff, issue a price update during "Being cleaned". As the customer, see progress kept and the approval card, approve it, then decline another with a message
  - as staff, suggest a pickup time, then replace it. As the customer, accept the latest
  - as staff, get a fresh link and confirm the old one stops working
  - open an expired link and an invalid link
- **Next.js DevTools:** no runtime or build errors on `/o/[token]` and `/orders/[id]`
- **Neon MCP** (`development`, read-only): only token hashes are stored, approvals recorded with `approvedByActor = CUSTOMER`, pickup window statuses match each step, and tracking-link audit events exist

## References

- @context/project-overview.md (Guest tracking link, Quotes and revisions, Order stages, Payment states, Fulfilment)
- @context/coding-standards.md (Security → tracking tokens, plain customer wording)
- @context/features/09-staff-order-entry-spec.md ("Outside normal schedule")
- @context/features/10-orders-list-and-detail-spec.md (`getBalance`)
- @context/features/11-order-stages-spec.md (`canTransition`)
- @context/features/12-quotes-and-revisions-spec.md (shared approve and decline operation, `stageBeforeQuote`)
- @context/features/13-customer-booking-spec.md (customer layout, confirmation page, estimate rule)
