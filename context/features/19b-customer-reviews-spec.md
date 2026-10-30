# Feature 19b — Customer Reviews (private to the store)

## Overview

After an order is completed, the customer can rate the store from 1 to 5 stars, with an optional short comment, on their order page. One reminder email is sent a few hours later. Reviews are **private to the store**: owners and staff see them in the workspace, and nothing is public. Public reviews come later with the marketplace, built on the reviews collected here.

## Requirements

### Who can leave a review

- **Only through the order's private link** (`/o/{token}`), for a completed order. The link authorizes the review: anyone holding it could technically submit one, so a review is treated as **linked to a real completed order**, not as identity-verified. No accounts are added for this
- **One review per order,** final once submitted. No editing or deleting
- **Within 7 days** of the order being completed, measured exactly: until 7 × 24 hours after `completedAt` (for example, completed 29 Oct at 3:00 PM means open until 5 Nov at 3:00 PM). After that, the review card no longer appears and the server refuses
- **A review can only be created while the order is Completed.** Never for cancelled orders. If an owner reopens a completed order before a review is left, the card disappears, and returns only if the order is completed again (with the 7 days counted from the new completion)
- **Once left, a review is permanent,** even if the order is later reopened or cancelled. Reopening never gives a second chance to review
- **A review never changes anything else:** not the order's stage, payments, prices, or link
- The usual link rules apply: an expired or unknown link, or a Deactivated store, can't be used to review

### What a review is

- **A star rating from 1 to 5** (required)
- **A comment** (optional, up to 300 characters, plain text, trimmed, empty stored as `NULL`)

### The review card (customer's order page)

- Shown when the order is completed, has no review yet, and is within the 7 days
- Plain wording: "How was your laundry? Rate your experience with {store name}." with five stars and an optional comment box ("Tell us more (optional)")
- The stars work as a labelled choice of 1 to 5 for keyboard and screen-reader users, not only as icons
- **Suggestion chips:** after choosing stars, a few short suggestions appear as tappable chips under the comment box. Tapping one adds it to the comment. Customers can tap several, edit the text, or ignore them all
  - **Nothing is ever prefilled.** Text only enters the comment when the customer taps a chip or types, so every comment is something they chose
  - The suggestions follow the stars:
    - **5 or 4 stars:** "Clothes came back fresh" · "Pickup was on time" · "Friendly service" · "Great value"
    - **3 stars:** "Good, but slow" · "Some items need another wash" · "Could communicate better"
    - **2 or 1 stars:** "Pickup or delivery was late" · "Items were damaged" · "Clothes not properly cleaned" · "Poor communication"
  - Changing the star rating changes the chips shown, but anything already in the comment stays
  - A chip is added after any existing text, with " · " in between (for example "Very good · Friendly service")
  - A chip already in the comment **as its own phrase** isn't added twice (so "Great value for money" typed by the customer doesn't block the "Great value" chip)
  - If the whole chip and its separator don't fit within 300 characters, nothing is added. A chip is never cut short
  - The chips are buttons that work with a keyboard and screen readers
  - The chip wording lives in one place in the code, so it can be changed later, and so patterns can be counted later
- **Submit** saves it. Afterwards the card reads "Thank you for your review" with the stars they chose
- Submitting twice, or after a review already exists, never creates a second review: the page simply shows the thank-you card

### Saving a review (server)

- A token-based action, like Feature 14's: it checks the token, the link, that the order is completed, within 7 days, and not cancelled, then saves
- The store and order come from the token's order, never from the request
- A unique rule on the order means at most one review per order, even with simultaneous submits

### The reminder email (timing)

- **Email only**, never SMS, so it costs nothing per order. Customers without an email still see the card on their order page
- Sent **once per order**, about **3 hours after completion**, so the customer has time to unpack and check their clothes
- **Never at night:** only between 8:00 AM and 8:00 PM in the store's time zone. If 3 hours after completion falls outside that window, it waits until 8:00 AM
- **One reminder per order** means one email message. Feature 15's retries are attempts at that same message, never new ones. Reopening and completing an order again never sends a second reminder
- It is queued on the first 5-minute run after it becomes due, so "about 3 hours" may be a few minutes more
- **Sent by the existing scheduled job** (every 5 minutes): it looks for orders completed more than 3 hours ago and less than 7 days ago, with no review and no review email yet, within the daytime window, and queues one review email for each through Feature 15's outbox (template `REVIEW_REQUEST`). Each order gets at most one, enforced in the database, so a repeated job run never sends a second
- Only when the customer has an email and the store's **email copies** setting is on
- Plain wording, with the store's name first: "{Store name}: thank you for your order {order number}. How did we do? Leave a quick rating here: {link}". The link is issued fresh through Feature 14's link issuing, like other messages with a link
- Not sent if the customer has already reviewed, or the order has since been reopened or cancelled
- **A last check just before sending:** if the email is retried later and by then the customer has reviewed, the order was reopened or cancelled, or the review window has ended, it isn't sent and is marked as no longer needed

### Seeing reviews (owners and staff, never riders)

- **A Reviews page** (`/reviews`), with a "Reviews" item in the workspace menu for owners and staff:
  - the store's **average rating** and **number of reviews**, for the last 30 days (exactly 30 × 24 hours) and for all time
  - each review, newest first: the stars, the comment, the customer's current name (no separate copy is stored), the order number (linking to the order), and the date
  - a filter by star rating, and "Load more", 25 at a time
- **The order page** shows that order's review, if any, near the top
- **A staff notification** for each new review, through the bell from Feature 17b: "Musa rated FF-1024 ★★★★★ (5 out of 5)", never including the comment. New notification type `REVIEW_RECEIVED`, source: the review, audience: owners and staff. Created in the **same transaction** as the review, following 17b's one-per-event rule
- Riders see no reviews, on any page or request

### Privacy

- Reviews are never shown publicly: not on booking pages, link previews, or anywhere outside the workspace
- Comments are plain text, shown escaped. The customer's phone and address never appear with a review

### Schema changes (Ask First)

One migration:

- New model `Review`: `id`, `storeId`, `orderId` (unique), `rating` (1 to 5, with a database check), `comment` (`String?`, up to 300 characters), and `createdAt`. Linked to its order through `[storeId, orderId]`, like every store-owned record. Index on `[storeId, createdAt]`
- `NotificationType` gains `REVIEW_RECEIVED`
- The database guarantees one review email per order (for example a unique rule on order and template for `REVIEW_REQUEST` messages, or an equivalent the AI proposes for approval)

### Store isolation

- On the workspace side, the store comes only from the membership, and every review query filters by it
- On the customer side, the store comes only from the token's order
- A review is always created with the same store as its order, enforced by the database link

## Not in this feature

- Public reviews, star ratings on booking pages, or anything for the marketplace
- Store replies to reviews, reporting or hiding reviews
- Editing or deleting reviews
- SMS review reminders, or more than one reminder
- Rewards or discounts for leaving a review

## Done when

- Unit tests: the chips shown for each star rating, the " · " separator, a chip added once only as its own phrase, a chip never cut short or added past 300 characters, and nothing in the comment before the customer acts
- Unit tests: the 7-day window, the daytime sending window in the store's time zone (including completion late in the evening waiting until 8:00 AM), and the rating and comment rules
- Integration tests:
  - a customer can review a completed order through their link, once only. A second submit, including two at the same moment, creates no second review
  - reviews are refused for orders that aren't completed, are cancelled, are past 7 days, or have an expired or unknown link
  - a retried reminder email that is no longer needed (already reviewed, reopened, cancelled, or past the window) isn't sent
  - a reopened and re-completed order gets no second reminder and no second review
  - the scheduled job queues exactly one review email per eligible order, only after 3 hours, only in daytime, never twice across repeated runs, and not when the customer already reviewed, has no email, or email copies are off
  - a new review creates one staff notification
  - owners and staff see the Reviews page and averages, riders are refused, and a FreshFold user never sees a CleanWave review
  - reviews never appear on the booking page or any customer-facing page other than the reviewer's own thank-you card
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP**, at ~360px and desktop, light and dark:
  - complete an order, open its link as the customer, choose 4 stars, tap two suggestions, edit the comment, submit, and see the thank-you card
  - change the stars after tapping a chip, and confirm the chips change while the comment stays
  - as staff, see the bell notification, the review on the order page, and the Reviews page with its average
  - as a rider, confirm there's no Reviews menu item and the page is refused
- **Next.js DevTools:** no runtime or build errors on `/o/[token]`, `/reviews`, and `/orders/[id]`
- **Neon MCP** (`development`, read-only): one review per order, and one review email per eligible order

## References

- @context/project-overview.md (Guest tracking link, Notifications, Staff accounts and roles)
- @context/features/14-guest-tracking-and-approvals-spec.md (token actions, link rules, link issuing)
- @context/features/15-notifications-spec.md (outbox, scheduled job, email)
- @context/features/17b-remove-per-kg-and-staff-notifications-spec.md (the bell)
