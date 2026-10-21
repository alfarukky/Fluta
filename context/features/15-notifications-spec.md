# Feature 15 — Notifications

## Overview

Customers get short SMS messages at the moments that matter: their order link, a price update waiting for approval, order ready, and order on its way. Messages go out reliably through a PostgreSQL outbox with retries, from one registered Fluta sender name, starting with the store's name. Customers with an email address also get an email copy of every message. Staff can send a link or message by WhatsApp from their own phone. Owners can switch each channel on or off.

## Requirements

### Which messages, and which contain a link

Only messages that need the customer to act contain a link. Fluta keeps a raw tracking link only briefly, inside an unsent message, and clears it as soon as the message is sent or finally fails. **Every message with a link issues a fresh one** through Feature 14's token issuing, which replaces the customer's previous link. The newest message always has the working link.

- When a new link is issued for an order (by any message, "Get tracking link", or WhatsApp), any of that order's unsent messages (SMS or email) still holding an older link are set to `REPLACED` in the same transaction, with their body cleared. `REPLACED` is final: the scheduled job never picks it up, and the order page shows "Replaced by a newer message"

| Message | When | Link | Daily cap |
| --- | --- | --- | --- |
| Order link | An online booking is created (Feature 13), a staff-entered order is created (Feature 09), or staff choose "Send link by SMS" | Yes, fresh | Online bookings only |
| Price update | A price update needs the customer's approval (Feature 12) | Yes, fresh | No |
| Ready | The order moves to Ready (Feature 11) | No | No |
| On its way | The order moves to Out for delivery (Feature 11 or 14b) | No | No |

### Message wording

- Every message starts with the store's name and includes the order number (`formatOrderNumber`)
- Written in plain characters only, so each part costs one standard SMS: no ₦ sign (use "NGN" if an amount is ever needed), no curly quotes, no emoji, no semicolons. Price update messages contain no amounts
- Links are built with `getTrackingUrl`. Messages with a link end with a short safety line using the app's domain (from `BETTER_AUTH_URL`)
- Messages without a link end with the store's phone number for questions
- Examples:
  - Order link: "FreshFold Laundry: we received your order FF-1024. Follow it here: {link} Real links start with {domain}"
  - Price update: "FreshFold Laundry: a price update for order FF-1024 needs your approval. Please use the link in this message: {link}"
  - Ready (drop-off): "FreshFold Laundry: order FF-1024 is ready for collection. Questions? Call {store phone}"
  - Ready (pickup): "FreshFold Laundry: order FF-1024 is ready and will be delivered soon. Questions? Call {store phone}"
  - On its way: "FreshFold Laundry: order FF-1024 is on its way to you. Questions? Call {store phone}"

### Who gets which channel

- SMS and email are decided **independently**, each by its own rules. A foreign number with an email still gets the email. A Nigerian number with SMS turned off still gets the email if email copies are on
- Each channel's setting is checked **when the message is queued**. Changing a setting later doesn't affect messages already queued
- The **recipient** (the phone in E.164, or the normalized email) is saved on the message when it is queued, and the message always goes there

### Who gets SMS

- Only customers with a Nigerian number (+234), and only when the store's **SMS** setting is on
- Other customers still get their link on the booking confirmation, by email if they gave one, or by WhatsApp from staff
- Fluta pays for all SMS. Messages go from **one registered Fluta sender name** over Termii's transactional route, so they reach numbers on Nigeria's Do-Not-Disturb list

### Daily cap on booking messages

- The "Order link" message after an **online booking** is capped at `Store.dailyBookingSmsCap` (default 100) per store per day, in the store's time zone
- The cap counts **only** order-link SMS created by an online booking (created by the customer, with no staff user). Staff-created orders, "Send link by SMS", "Send again", price updates, Ready, and On its way never count and are never capped
- Two bookings at the same instant may send a second alert email, or go a message or two past the cap. This is accepted: the cap is a cost guard, and the alert goes to Fluta
- At 80% of the cap, one alert email per store per day goes to `FLUTA_ALERT_EMAIL`
- At the cap, the booking still succeeds and no SMS is queued. The customer already sees the link on the confirmation page
- Messages triggered by staff actions are never capped

### Reliable sending (the outbox)

`MessageEvent` is the outbox, as described in the overview:

1. The message is saved as `QUEUED` in the **same transaction** as the change that triggers it (order created, price update issued, stage changed, link sent), so a message never exists without its change
2. Right after the transaction commits, Fluta tries to send it
3. A scheduled job at `/api/cron/messages`, run every 5 minutes by the host and protected by `CRON_SECRET`, retries messages still `QUEUED` or `FAILED`, up to **3 attempts** in total
4. Before sending, each sender **claims** the message by switching `QUEUED` (or `FAILED`) to `SENDING` in a single conditional update, so two senders can never send the same message at the same time. **Claiming uses up an attempt:** it increases `attempts` and sets `lastAttemptAt` in that same update. A message that has used 3 attempts is never claimed again. The 5-minute schedule is the delay between attempts
5. A message stuck in `SENDING` for more than 10 minutes after its `lastAttemptAt` (for example if the server stopped mid-send) is claimed again, which uses up its next attempt
   - If the server stopped after Termii accepted the message but before it was marked `SENT`, the retry may send it again. This rare duplicate is accepted: a message sent twice is better than one lost
   - If Termii supports a unique reference per message that prevents duplicates (check with Context7), send the message's ID as that reference
6. On success: `SENT`, with `sentAt` and the provider's message ID. `SENT` means Termii accepted it, not that the phone received it
7. After the last failed attempt: `FAILED`, with the last error (never containing the message body or token)
8. The message body is cleared once the message is `SENT` or finally `FAILED`, because it may contain a raw token

- The order detail page shows each message's status, with labels that follow the channel. A finally failed message shows **"SMS not sent"** or **"Email not sent"** with **Send again**, which queues a new message (with a fresh link if it is a link message). Send again is a staff action and never counts towards the cap

### Email copies

- When the customer has an email and the store's **Email copies** setting is on, **all four** messages (Order link, Price update, Ready, On its way) are also sent by email through the same outbox (channel EMAIL) and Feature 08's Resend mailer. Email stays optional for customers
- Same wording as the SMS, with the store's name in the subject. Email copies are not capped and don't count towards the SMS cap
- Receipt emails come with Feature 19

### Manual WhatsApp

- On the order detail page, when the store's **WhatsApp** setting is on: **"Send link by WhatsApp"** (issues a fresh link, like Feature 14's "Get tracking link") and **"Message on WhatsApp"** (no link)
- Each opens WhatsApp on the staff member's phone with the customer's number and a prepared message they can edit before sending. Works for any country's number
  - "Message on WhatsApp": "Hello {customer name}, this is {store name} about your order {order number}."
  - "Send link by WhatsApp": the same greeting followed by "You can follow your order here: {link}"
- Fluta records a `MessageEvent` with channel `WHATSAPP_MANUAL` and status `OPENED`, with no body. It never claims the message was delivered

### Replaced-link page (updates Feature 14)

- The "invalid link" page from Feature 14 now reads: "This link may have been replaced by a newer message from {store name}. Please open the latest message, or call the store." with the store's phone as a Call link. No other change

### Communication settings (owner)

- In Settings, owners can switch on or off: **SMS**, **Email copies**, and **WhatsApp button** (`smsEnabled`, `emailCopiesEnabled`, `whatsappContactEnabled`). Saving uses Feature 07's shared edit check
- Turning SMS off stops new SMS only. Messages already queued are still sent

### Clearing old booking IP hashes

- The same scheduled job clears `bookingIpHash` on all orders older than 24 hours (from Feature 13)

### Schema changes (Ask First)

One migration:

- Add `REPLACED` to `MessageStatus`
- Add `MessageEvent.recipient` (`String`, the phone or email used) and `MessageEvent.lastAttemptAt` (`DateTime?`)

### The scheduled job's secret

- `/api/cron/messages` requires `CRON_SECRET`, compared in a timing-safe way, before doing any work. A wrong or missing secret returns 401 and reveals nothing. A signed-in session can't substitute for it. The secret is never logged

### Integration and environment

- Termii is called only from `src/server/integrations/termii.ts`
- New variables in `env.ts`, `.env.example`, `.env.local`, and `.env.test`: `TERMII_API_KEY`, `TERMII_SENDER_ID`, `CRON_SECRET`, `FLUTA_ALERT_EMAIL`
- Tests use a fake SMS provider and the fake mailer, and never call Termii or Resend. In development, when Termii isn't configured, a development provider marks messages as sent without sending or printing them
- Never log message bodies, raw tokens, or full phone numbers

## Not in this feature

- Automated WhatsApp messages (Later)
- Receipt emails (Feature 19)
- Payment messages (Features 16 to 18)
- Customers choosing their own message preferences
- Delivery reports from Termii

## Done when

- Unit tests: each message's wording (store name first, order number, plain characters only, link or phone line), Nigerian-number detection, the daily cap count in the store's time zone, and the stuck `SENDING` rule
- Integration tests:
  - each trigger queues its message in the same transaction as its change, and a rolled-back change leaves no message
  - a link message issues a fresh token, and the previous link stops working
  - a queued link message (SMS and email) becomes `REPLACED` when a newer link is issued for the order, is never picked up by the scheduled job, and shows as "Replaced by a newer message"
  - claiming uses up an attempt, and a message with 3 used attempts is never claimed again
  - only online-booking order-link SMS count towards the cap, and Send again never does
  - a foreign number with an email gets the email, and a Nigerian number with SMS off gets the email when email copies are on
  - each message's recipient is saved when it is queued
  - Ready and On its way messages contain no link
  - a non-Nigerian number gets no SMS but still gets an email copy when it has an email
  - with email copies on, each of the four messages is also queued as an email for a customer with an email address
  - an unknown or replaced link shows the "may have been replaced" message with the store's Call link
  - the 101st online booking SMS in a day for a store is not queued, the booking still succeeds, and one alert email is sent at 80%
  - two senders claiming the same message: it is sent once
  - a message that fails 3 times ends `FAILED`, its body is cleared, and the order shows "SMS not sent"
  - a sent message has its body cleared
  - the scheduled job refuses requests without the right `CRON_SECRET`, including from a signed-in user
  - the scheduled job clears booking IP hashes older than 24 hours
  - "Send link by WhatsApp" issues a fresh link and records an `OPENED` event with no body
  - each setting turned off stops its channel for new messages
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** at ~360px and desktop, light and dark:
  - book online and see the order link message recorded on the order detail page
  - issue a price update and see the price update message, then confirm the old link no longer works
  - move an order to Ready and Out for delivery and see those messages
  - use "Send link by WhatsApp" and "Message on WhatsApp"
  - switch each communication setting off and on
- **Next.js DevTools:** no runtime or build errors on `/orders/[id]`, `/settings`, and `/api/cron/messages`
- **Neon MCP** (`development`, read-only): message statuses and attempts match each step, and no sent or failed message still has a body

## References

- @context/project-overview.md (Notifications, Guest tracking link)
- @context/coding-standards.md (Notifications, Security)
- @context/features/08-staff-management-spec.md (mailer)
- @context/features/11-order-stages-spec.md and @context/features/14b-deliveries-and-rider-role-spec.md (stage changes)
- @context/features/12-quotes-and-revisions-spec.md (price updates)
- @context/features/13-customer-booking-spec.md (booking, IP hashes)
- @context/features/14-guest-tracking-and-approvals-spec.md (token issuing, `getTrackingUrl`)
- Termii docs: check current APIs with Context7
