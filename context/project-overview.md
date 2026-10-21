# 🏗️ Fluta — Project Overview

**One-line summary:** Fluta is a SaaS platform that independent laundry stores subscribe to so they can manage their daily operations (orders, services, pickup/delivery, quotes, payments, staff) in one place. It also gives each store a simple booking and order-tracking page for its customers, who never need to create an account.

**Branding:** Fluta has its own neutral look, used in the store workspace and Fluta admin. Each store's name, logo, and colours appear on that store's customer-facing pages (booking, tracking, quote approval, payment), hosted on Fluta's domain, so customers recognise the store they are dealing with.

|                     |                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Product type**    | Multi-tenant B2B SaaS (laundry operations tool) with a store-branded guest booking and tracking page |
| **Platform**        | Mobile-first responsive web app (no native app in the MVP)                                           |
| **Launch market**   | Nigeria-first (Paystack, Termii, NGN), exact pilot geography still open                              |
| **Revenue**         | Monthly store subscription fees, plus an optional per-store fee on online payments (default 0%)     |
| **Document status** | MVP baseline · last updated 20 October 2026                                                          |

### How to read this document (for humans and AI assistants)

- **Store** means one independent laundry business (a tenant). Every store-owned record belongs to exactly one store and must never leak to another store.
- **Must** and **never** are hard rules. Items marked **(Assumption)** are reasonable defaults that were not in the original product definition and may change. Items marked **(Open)** are undecided and should not be invented.
- Anything listed under _Out of scope_ must not be built in the MVP, even if it seems helpful.
- Code conventions, module boundaries, security implementation, migrations, CI, and AI review rules live in `coding-standards.md`, not here.

---

## 📌 Problem

Independent laundry stores run their business across disconnected tools, and their customers get little visibility into their orders:

- 📱 **Orders arrive everywhere:** walk-ins at the counter, phone calls, WhatsApp chats, and word of mouth, with no single list of open orders.
- 📒 **Records live on paper or in chat history:** notebooks, receipt books, and WhatsApp threads make it hard to know what is pending, ready, or unpaid.
- ⚖️ **Pricing is messy:** per-kg washing needs weighing before a price exists, and quotes or later changes are agreed verbally, which causes disputes.
- 🚚 **Pickup and delivery are ad hoc:** time windows, service areas, and delivery charges are negotiated case by case.
- 💸 **Payments are hard to reconcile:** cash, transfers, POS, and online payments are recorded inconsistently, and refunds owed are easily forgotten.
- 🙋 **Customers are left guessing:** they have to call or message the store to ask "is my laundry ready?"
- 🏷️ **Small stores lack a professional online presence:** building their own booking site is too expensive, and generic marketplaces bury their brand.

**Fluta's answer:** one booking link and QR code per store (showing the store's own name and colours) for customer bookings, one workspace for staff to manage every order regardless of channel, explicit customer approval for every price, and a clear record of every payment, status change, and refund.

---

## 🧑‍💻 Target Users

| User                  | Who they are                          | Main purpose                                                                                         | Account?                                                            |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Store owner/admin** | Owner or manager of one laundry store | Configure branding, services, prices, staff, payment details, fulfilment settings, and view finances | Yes, email + password                                               |
| **Store staff**       | Counter and operations staff          | Enter orders, quote prices, record store-collected payments, update order stages                     | Yes, email + password                                               |
| **Customer**          | The store's own customers             | Book as a guest, approve a quote or revised total, pay, and track one order                          | **No.** Identified by name + phone; access via a private order link |
| **Fluta admin**       | Fluta's internal team                 | Onboard stores, manage subscriptions, review summaries, run logged read-only support lookups         | Yes, platform-level role                                            |

**Primary customer of Fluta:** existing laundry stores (they pay the subscription).
**Primary end users of the booking flow:** those stores' existing customers.
Fluta does **not** do laundry, own riders, or send customers between stores.

---

## ✨ Core Features

### 1. Store workspace and branding

- Fluta admins create each store workspace and invite its owner (no self-service signup in the MVP).
- Each store has a profile (name, description, address, phone, email), an optional logo, brand colours, a customer booking link on Fluta's domain at `/store/{slug}` (for example `/store/freshfold`), and a QR code. Once a store's link is in use, it must keep working permanently, because it is printed on QR codes.
- Store branding is applied **only to that store's customer-facing pages**. Staff and owners work inside Fluta's own neutral interface.
- **Home-screen app per store:** customers can add a store's booking page to their phone's home screen. It then appears like an app, with the **store's logo and name**, and opens the booking page full-screen without browser bars. Each store has its own, and customers never see a "Fluta" app.
  - Built as a web app manifest per store (start page and scope `/store/{slug}`), not a native app. No app store, no offline mode, no push notifications.
  - Icons are generated from the store's logo on its brand colour, in the sizes phones need (including an Apple touch icon). A store without a logo gets its initials on its brand colour, or on Fluta's default colour if none is set.
  - On phones, the booking page shows a small, dismissible "Add to Home Screen" hint once. Dismissing it is remembered in the phone's browser storage.
- **Link previews:** when a store's booking link is shared on WhatsApp, Facebook, or by text, it shows a card with the **store's logo, name, and a short line** (the store description, or "Book your laundry with {store name}"). The preview image is generated from the logo and brand colour.
  - **Tracking links never show order details in a preview.** A shared `/o/{token}` link shows only a generic card with the store's name and "View your laundry order", never the customer's name, items, amounts, or stage.
- **Branding inputs are untrusted:**
  - **Colours** must match `#RRGGBB` exactly (validated with Zod on save and again before rendering). They are only ever inserted as CSS variable values, never as raw CSS.
  - **Text colour on brand-coloured elements is chosen automatically** (dark or light, whichever meets WCAG AA contrast), so any brand colour stays readable.
  - **Description** is plain text only (no HTML or Markdown), length-limited, and rendered escaped.
  - **Logos:** PNG, JPEG, or WebP only; max 1 MB and 2000 × 2000 pixels; type checked from the file's actual bytes, not its extension or claimed type. **No SVG** in the MVP. Fluta generates the R2 object key and sets the stored content type itself; `logoKey` (the R2 object key) is stored, never a URL; the public address is built by `getLogoUrl()`. Only owners and Fluta admins can upload.
- Stores are fully independent; one store = one location (no multi-branch accounts).

### 2. Staff accounts and roles

- Owners, staff, and riders each have an individual email-and-password account. **Riders** are the store's own employees who do pickups and deliveries. They are invited like staff, with the Rider role, and can only use the Deliveries view.
- Fixed roles only:

| Permission                                                                                | Rider | Staff | Owner |
| ----------------------------------------------------------------------------------------- | :---: | :---: | :---: |
| Deliveries view: mark picked up, out for delivery, delivered                              |  ✅   |  ✅   |  ✅   |
| Create and manage orders, quotes, stages                                                  |  ❌   |  ✅   |  ✅   |
| Record store-collected payments                                                           |  ❌   |  ✅   |  ✅   |
| Cancel an order                                                                           |  ❌   |  ✅ (note **required**) |  ✅ (note optional) |
| View orders-by-status counts                                                              |  ❌   |  ✅   |  ✅   |
| View financial dashboard and reports                                                      |  ❌   |  ❌   |  ✅   |
| Manage settings, services, prices, service areas, schedule                                |  ❌   |  ❌   |  ✅   |
| Invite and deactivate staff and riders                                                    |  ❌   |  ❌   |  ✅   |
| Void and replace a store-collected payment or a recorded refund (reason required, logged) |  ❌   |  ❌   |  ✅   |

- Deactivating a staff account keeps their order history intact, sets the membership inactive, and **revokes their active sessions** (Better Auth session revocation) so they are signed out immediately. The server-side membership check on every request remains the real guarantee.

### 3. Service catalogue

- Each service has a **name**, **price**, **pricing type**, **quote required** flag, and optional **category label**.
- Pricing types (the unit the price is charged by): **per item**, **per kg**, **per package**.
- **Quote required** (separate from the pricing type) means the final price is only known after staff weigh or inspect the items:
  - **Per-kg services always require a quote**; the flag is forced on and cannot be switched off.
  - Per-item and per-package services can have it switched on by the owner (for example, leather cleaning or a wedding dress).
  - Customers see a quote-required service's price as a starting price (for example "from ₦5,000").
- **Estimated vs billed quantity:**
  - At online booking, customers may enter an **estimated** weight for per-kg services. It is saved as `estimatedQuantity`, used only to show an indicative total, and **never billed**.
  - `quantity` is always the **billed** quantity: the item count, or the weight staff measure after receiving the clothes.
  - The quote snapshot records the exact quantity the customer approved. Example: customer estimates 5 kg → store weighs 7.4 kg → quote issued for 7.4 kg → customer approves 7.4 kg.
- The price at order time is **snapshotted onto the order line**; later catalogue changes never rewrite historical orders.
- Customers can book catalogue services only. Staff can add an **Others** line with a required description and a **signed** amount (positive = extra charge, negative = discount).
- Customers can also leave an optional note when booking ("Anything else? Other items or instructions", up to 300 characters). It is stored on the order as `customerNote`, shown only to staff, and never priced automatically. Staff price anything extra through a normal revision the customer approves.
- Every order line is one of two types:
  - **Service line:** a catalogue service with quantity, unit price (never negative), and line total = unit price × quantity, rounded to the nearest kobo. On quote-required lines, the billed quantity and line total stay empty until staff weigh or inspect; every line must have both before a priced quote is issued.
  - **Adjustment line** ("Others"): a description and a signed amount only; no service, quantity, or unit price.
  - Order total = sum of service line totals + sum of adjustment amounts + any pickup/delivery charge.

### 4. Customers (lightweight, not a CRM)

- List of the store's customers: name, full phone number (staff need it to call and WhatsApp), email, number of orders, last order, outstanding balance where relevant.
- Opening a customer shows their order history. No marketing tools, tags, or bulk export.

### 5. Order intake

- **Online (guest):** customer uses the store's booking link, enters name and phone number. **Email is optional unless the customer pays online**; Paystack requires one, so a valid email is asked for at the payment step (pre-filled if given at booking).
- **Phone numbers:** any valid international number is accepted and stored in E.164 format (for example `+2348031234521`, `+447700900123`).
- **Who sees the customer's phone number:**

| Viewer                                 | Phone shown                                                        |
| -------------------------------------- | ------------------------------------------------------------------ |
| Store owner and staff (own store only) | Full                                                               |
| Customer on their tracking page        | Masked (for example +234 803 \*\*\* 4521)                          |
| Fluta admin, anywhere                  | Masked                                                             |
| Fluta admin in a support lookup        | Masked; can reveal one number with a reason, which is audit-logged |

- **Online booking limits** (to stop fake bookings, pilot defaults):

| Limit                                             | Default                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| Online bookings per phone number, per store       | 5 per 24 hours                                                    |
| Online bookings per IP address, across all stores | 20 per hour (generous because Nigerian mobile networks share IPs) |

Limits are checked by counting recent orders in PostgreSQL (no Redis). A blocked booking shows a friendly "too many bookings, please try again later or contact the store" message. Staff-entered orders have no limit.

- **Staff-entered:** staff create orders received at the counter, by phone, or via WhatsApp. A counter order starts at **Received by store**.
- Each order records its channel (online, counter, phone, WhatsApp).
- **Order numbers** are sequential **per store** and shown with that store's own short prefix, for example **FF-1024** for FreshFold Laundry. **(Assumption)**
  - The prefix (2–4 capital letters) is set by Fluta admins at onboarding and is display-only; changing it never changes the stored number, and staff can search by number alone.
  - **Allocation is concurrency-safe:** inside the transaction that creates the order, one statement increments `Store.nextOrderNumber` and returns the number just allocated (`UPDATE "Store" SET "nextOrderNumber" = "nextOrderNumber" + 1 WHERE "id" = $1 RETURNING "nextOrderNumber" - 1`). The row lock means two simultaneous bookings can never get the same number; `@@unique([storeId, orderNumber])` remains as a backstop.

### 6. Returning customers (no customer accounts)

Repeat bookings should take a few taps, without logins or server-side customer profiles.

**On the customer's phone (online bookings)**

- **Browser autofill:** booking form fields use proper `autocomplete` attributes (`name`, `tel`, `email`, `street-address`) so the phone's own autofill can fill them.
- **"Book the same as last time?"** When a customer confirms a booking, and again when they open their tracking page, the page saves that order's **service IDs, quantities, and date** in the phone's browser storage, per store. Viewing the tracking page after weighing updates the saved weight to the measured value. On their next visit to that store's booking page they see the saved services with **Use these** and **Start fresh**.
  - Services no longer offered are skipped; prices always come from today's catalogue; if nothing valid remains, no prompt is shown.
- **"Remember my details on this phone"** (checkbox on the details step, ticked by default) saves name, phone, email, service area, address, and last fulfilment choice in browser storage, per store. Next time they are pre-filled, with a **"Not you? Clear details"** link.
  - A saved service area the store no longer serves is not pre-selected.
  - Unticking the checkbox clears anything saved.
- Nothing extra is stored on Fluta's servers. Storage reads and writes are wrapped in error handling; if storage is unavailable (private browsing, cleared data, some in-app browsers) the booking page works normally without prompts.
- Result: a returning customer's booking is usually **Use these → pick date and window → confirm**.

**In the store workspace (staff-entered orders)**

- **Repeat order** on the order detail and on the customer's page opens the normal new-order form pre-filled from that order. Staff adjust it, set the channel (counter, phone, WhatsApp), and create it.

| Copied                                           | Not copied                                              |
| ------------------------------------------------ | ------------------------------------------------------- |
| Customer                                         | Old prices (today's catalogue is used)                  |
| Per-item and per-package services and quantities | Per-kg weight (left blank; staff weigh the new clothes) |
| Fulfilment choice, service area, address         | Adjustment ("Others") lines                             |
|                                                  | Pickup date and window; payments, notes, history        |

- Disabled services are skipped with a note. The result is a new, independent order with its own number, version 1 revision, and tracking link.

### 7. Fulfilment, service areas, and scheduling

- Each store enables **drop-off/collection**, **pickup/delivery**, or both.
- The store lists the **service areas** it covers. Online pickup customers choose one of those areas, then type their address. A service area is a store-defined **named zone**, not a map boundary: Fluta never checks whether an address belongs to an area. Staff confirm the area against the address and correct it through a revision if needed.
- Per service area, the owner sets either a **fixed pickup/delivery charge** (shown before booking) or **quote required** (staff enter a charge after reviewing the address). The charge is **one per order, covering both pickup and return delivery**; if only one trip happens, staff adjust it with an Others line.
- Staff may manually create an **out-of-area** order once the store agrees, recording its charge on the order.
- **Default delivery fee (optional, per store):** when the owner sets one, online customers outside the listed areas can choose **"My area isn't listed"**, type their area name, and book at that fee. The order is marked out of area, with the typed name and the fee copied onto it. Empty means only listed areas can be booked online. ₦0 means free. Pickup is available when there is at least one active area or a default fee. Out-of-area orders show an "Outside our service areas" badge to staff.
- **"Use my current location" (optional):** at booking, a customer can share their location with permission. The typed address always stays the real one. The coordinates are only for navigation: staff and riders get an "Open in Maps" button. They are never used for the area, price, or availability, are never shown to customers, and are cleared 30 days after the order is completed or cancelled.
- Staff may likewise book a pickup **outside the normal schedule** (for example a Sunday, or a 7:00 PM pickup) once the store agrees, choosing any day and a custom time, with a required note. The order is marked so the exception stays visible. Online bookings always follow the schedule.
- **One address per order:** the MVP assumes pickup and delivery use the **same customer address** (`Order.addressText`). Staff can edit it before delivery if the customer asks; the change is recorded in the order history.
- One shared operating schedule for pickup and delivery: active days, general hours, and one-off closed dates.
- The customer picks an eligible pickup date and a preferred time window. This is a **request**, not a guaranteed slot.
  - **Windows are fixed 2-hour blocks** generated from the store's hours, starting at opening time; the last window ends at closing time even if shorter.
  - Staff can confirm the requested window, **or** propose a different one, which the customer must explicitly accept on the private order link before the order becomes **Pickup scheduled**.
- No delivery date or completion time is promised at booking.
- All times display in the store's local time zone.
- The store handles all logistics itself; Fluta does not assign riders.

### 8. Quotes and revisions

- An order **needs a quote** if any line uses a quote-required service, or the pickup area's charge is **quote required**. Otherwise it is a **fixed-price order** and can be paid at booking.
- A **quote-required fulfilment charge** may need approval before pickup can be scheduled.
- A quote for **quote-required services** (weighing or inspection) follows receipt of the clothes.
- Staff can also revise any order after inspecting it (for example, extra items or stains); that is a normal revision needing customer approval.
- **Every order has a version 1 revision from the moment it is created.** For online fixed-price orders the customer approves it by confirming the booking; for counter, phone, and WhatsApp orders staff record it as agreed with the customer in person or by phone. For a quote-required order, version 1 records the booking estimate and is never approved; staff's priced quote becomes version 2, which the customer approves. Revisions are never edited; each change is a new version.
- Any change to an order's lines or total creates a new quote revision that the customer must **explicitly approve**. Approval records the approved version and time; a changed quote needs new approval.
- The customer can **approve** or **decline / request clarification** (with an optional message). A declined quote goes back to staff, who either issue a new revision or cancel the order.
- Revisions may go **up or down** (for example, lower actual weight, an item removed, a discount). Every change needs customer approval; a lower total on a paid order results in **Refund owed**.
- The quote screen always shows the previous amount, the new amount, the difference, and the staff-entered reason for the change.

### 9. Order stages

| Order type          | Customer-visible flow                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Drop-off            | Booked → Received by store → _Quote awaiting approval (if required)_ → In progress → Ready → Completed         |
| Pickup and delivery | Booked → Pickup scheduled → Picked up → Received by store → In progress → Ready → Out for delivery → Completed |

- **Quote awaiting approval** is inserted whenever a charge or inspected item needs approval (before pickup scheduling for a fulfilment charge, or after receipt for quote-required services).
- **Completed** = collected by the customer or delivered by the store.
- **Cancelled** is a separate terminal state (note required for staff, optional for owners). Order and payment history are kept.
- Staff advance stages **manually**, except the automatic moves in the table below. Every status change records its actor and time.
- **Payment state is shown separately from the order stage** and must never be merged into one status. Payment states:

| Payment state    | Meaning                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| Payment required | Customer must pay now (for example, fixed-price online order without pay later) |
| Pending          | A payment has started but is not yet confirmed                                  |
| Paid             | Confirmed payments cover the approved total                                     |
| Outstanding      | Approved total is higher than confirmed payments (includes pay-later orders)    |
| Refund owed      | Confirmed payments exceed the approved total plus refunds already paid          |
| Nothing due      | A cancelled order with nothing left to collect or return                        |

Payment state is **derived**, not stored: `balance = approved total − confirmed payments + refunds paid` (voided records excluded). Positive = outstanding, negative = refund owed, zero = paid. For a **cancelled** order the approved total counts as zero.

```text
                     ┌──────────── Cancelled (terminal, from any open stage) ────────────┐
Drop-off:   Booked ─► Received by store ─► [Quote awaiting approval] ─► In progress ─► Ready ─► Completed
Pickup:     Booked ─► [Quote awaiting approval*] ─► Pickup scheduled ─► Picked up ─► Received by store
              ─► [Quote awaiting approval] ─► In progress ─► Ready ─► Out for delivery ─► Completed
Counter:    (created at) Received by store ─► …same as drop-off
* only when the area requires a quoted pickup/delivery charge
```

#### Allowed transitions (the only source of truth)

All stage changes go through **one function**, `canTransition(from, to, context)`, which returns allowed/denied and the reason. API handlers never decide transitions themselves. It is covered by exhaustive unit tests (every from/to pair, both order types, both roles).

| From                                          | To                       | Who                                            | Condition                                                                     |
| --------------------------------------------- | ------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Booked                                        | Pickup scheduled         | Staff, or customer accepting a proposed window | Pickup order; window confirmed or accepted; no pending pickup-charge quote    |
| Booked                                        | Quote awaiting approval  | System                                         | Pickup order in a quote-required area, once staff enter the charge            |
| Booked                                        | Received by store        | Staff                                          | Drop-off order                                                                |
| Pickup scheduled                              | Picked up                | Staff                                          | —                                                                             |
| Picked up                                     | Received by store        | Staff                                          | —                                                                             |
| Received by store                             | Quote awaiting approval  | System                                         | Staff issue a priced quote for quote-required services                        |
| Received by store                             | In progress              | Staff                                          | No quote required, or quote already approved                                  |
| Quote awaiting approval                       | _stage before the quote_ | Customer approval (automatic)                  | Order returns to where it was (`stageBeforeQuote`); staff continue from there |
| In progress                                   | Ready                    | Staff                                          | —                                                                             |
| Ready                                         | Out for delivery         | Staff                                          | Pickup order                                                                  |
| Ready                                         | Completed                | Staff                                          | Drop-off order; no pending quote or revision                                  |
| Ready                                         | Completed                | Staff                                          | Pickup order collected in person by the customer ("Customer collected instead", note required); no pending quote or revision |
| Out for delivery                              | Completed                | Staff                                          | No pending quote or revision                                                  |
| Any open stage                                | Cancelled                | Staff (note required) or owner                 | —                                                                             |
| Any stage except Booked, Completed, Cancelled | Previous stage           | Staff                                          | Note required; one step back only, to fix mistakes                            |
| Completed                                     | Previous stage           | **Owner only**                                 | Note required; clears `completedAt`                                           |

**Edge-case rules (Assumption):**

- **Cancelled is final.** To redo an order, create a new one.
- **Customers cannot cancel** in the MVP; they contact the store.
- **Declined quote:** the order stays in _Quote awaiting approval_; staff issue a new revision or cancel.
- **Proposed pickup window not accepted:** the order stays _Booked_; staff propose another window or cancel.
- **Revisions after work has started** (for example an extra item found during _In progress_) do **not** change the stage; they show as "revised total awaiting approval" and block _Completed_ until approved or replaced.
- **No price revisions from Out for delivery onwards.** Anything that comes up from delivery onwards is resolved outside Fluta.
- **Mixed fulfilment** (pickup only, or drop-off with delivery) has no separate type: a pickup order can be completed from Ready when the customer collects in person, and staff adjust the charge with an Others line through a normal revision the customer approves.
- **Outstanding balance does not block Completed** (pay-later customers may collect first); the order shows the balance clearly.
- **Cancelling a paid order:** the approved total no longer applies, so everything paid (minus refunds already paid) shows as **Refund owed**. **(Open)** whether stores may keep a cancellation fee.

### 10. Guest tracking link

- Every order gets a **long random private link** sent to the customer's phone.
- Holding the link grants access to that one order's status, quote approval, revised-total approval, and payment actions.
- The page shows: order number, stage, relevant history, payment state, and any action required.
- The page **never shows**: the full phone number, the full address, internal notes, or staff names.
- Staff can **resend** the link. Because only the token's hash is stored, resending always issues a **fresh token** and invalidates the old link.
- **Link lifetime follows the order:**
  - While the order is open, the link works fully.
  - Once the order is **Completed** or **Cancelled**, there is nothing left to approve or pay, so the page is effectively view-only.
  - The link stops working **30 days** after the order is completed or cancelled, unless a refund is still owed on it. After that, the page says the link has expired and to contact the store. Staff can resend a fresh link if needed.
- **Keeping the link private:** tracking pages send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, are marked `noindex`, are excluded from analytics, and the raw token never appears in application logs or error reports.

### 11. Notifications

- **Automatic SMS** (Termii) when: the order link is created, a quote needs approval, the order is ready, and the order is out for delivery.
- **Fluta pays for all SMS**; stores never need their own SMS account. Messages go from one Fluta sender ID over Termii's transactional route (so they reach numbers on Nigeria's Do-Not-Disturb list), and each message starts with the store's name, for example _"FreshFold Laundry: your order FF-1024 is ready…"_.
- **Automatic SMS go only to Nigerian (+234) numbers.** Customers with other numbers still book normally and get their link on the booking confirmation screen, by optional email, or by staff via manual WhatsApp.
- **Daily cap on booking SMS:** the "your order link" SMS sent after an **online booking** is capped at **100 per store per day** (Fluta admins can change it per store). Fluta admins get an alert at 80%. Once the cap is reached, bookings still succeed; the customer sees their link on the confirmation screen instead of receiving an SMS. SMS triggered by logged-in staff (quote, ready, out for delivery, staff-entered orders) are not capped.
- **Reliable sending (PostgreSQL outbox, no Redis):** `MessageEvent` doubles as the outbox.
  1. The message is saved as `QUEUED` in the **same transaction** as the order change that triggers it, so a message never exists without its change and vice versa.
  2. Right after commit, Fluta tries to send it immediately.
  3. A scheduled job every few minutes retries anything still `QUEUED` or `FAILED`, up to **3 attempts**.
  4. After the last failed attempt it stays `FAILED` and the order shows **"SMS not sent – resend"** to staff.
  - Each sender first claims the message by switching `QUEUED` → `SENDING` in a single conditional update, so two senders never send the same message at once. A rare duplicate after a server stop is accepted rather than risking a lost message.
  - The message body (which contains the raw tracking token) is stored only until the message is `SENT` or finally `FAILED`, then cleared.
  - `SENT` means Termii accepted it, not that the phone received it.
  - Manual WhatsApp is not queued; it is only logged as opened.
- **Manual WhatsApp:** staff open a WhatsApp conversation with a prepared message or order link. Fluta records only that the action was **opened**; it never claims the message was delivered.
- **Email copies:** when the customer has an email and the store's email copies setting is on, every message (order link, price update, ready, on its way) is also sent by email. Email stays optional for customers.

### 12. Payments

- **Fixed-price online orders** require payment at booking by default; each store can enable **pay later**.
- **Orders that need a quote** (quote-required services or a quoted pickup/delivery charge) are paid after the customer approves the final total.
- **Online payments** go through **Paystack** into the store's own bank account via a **store subaccount**. Booking and store-collected payments never require an email.
- **Connecting the store's bank account (owner only, Settings → Payments):**
  1. Owner confirms the business name and selects their bank (list loaded from Paystack).
  2. Owner enters the account number. Fluta asks Paystack to resolve it and shows the **account name** returned; the owner must confirm it matches before continuing.
  3. Fluta creates the Paystack subaccount and saves the returned subaccount code, bank name, account name, and last 4 digits only. Fluta's share is set per payment, not on the subaccount (see Starting a payment).
  4. Settings shows **Connected** with those details.
  - Changing bank details repeats the same resolve-and-confirm steps, is owner-only, writes an audit entry, and emails the owner a notice of the change.
  - **Until a store is connected, online payment is unavailable:** its booking page offers no "Pay now", orders are treated as pay later, and staff record store-collected payments.
- **Starting a payment:** Fluta initializes the Paystack transaction with the store's `subaccount` code and `bearer: "subaccount"` (the store bears Paystack's fees), and sets Fluta's fee for that payment from the store's current rate (₦0 at 0%). The rate and fee used are recorded on the payment, so later rate changes never alter past payments.
- **Store-collected payments** (cash, bank transfer, POS) are recorded by staff with amount and method.
- Only **confirmed** payments count as received. An online payment is confirmed only by Paystack's signed webhook or a server-side verify call, **never** by the customer returning from checkout.
- **Revisions after payment:** if the revised total is higher, Fluta requests only the extra amount owed; if lower, the order shows **Refund owed**. The store refunds outside Fluta, and staff record the refund paid (amount and note). "Refund owed" is never stored; it is calculated from the balance.
- **Corrections (owner only):** a mistaken record is **voided, never edited or deleted**.
  - The owner voids the wrong store-collected payment or refund with a required reason. It stays visible in the history, marked void, and no longer counts in any total.
  - The owner then records the correct payment or refund, linked to the one it replaces.
  - Each void writes an audit entry (actor, reason, time, original record, replacement).
  - **Paystack payments cannot be voided**; a mistaken online payment is handled as a refund.
- Payments, approvals, revisions, refunds, and voids all stay in the order history.

### 13. Receipts

- Every order has a **receipt page** that staff open from the order detail and customers open from their tracking page ("View receipt").
- **Printing** uses the browser's print function with a narrow layout that works on A4 and on 58/80 mm thermal printers. No server-generated PDFs or printer integrations in the MVP.
- **Sharing:** staff send the tracking link by manual WhatsApp; the customer can view, print, or save the receipt from there. An optional email copy uses the existing email flow.
- **Contents** (from the currently approved quote revision and confirmed payments only):

```text
FreshFold Laundry
12 Admiralty Way, Lekki · 0803 000 1234
Order #FF-1024 · 30 Sep 2026, 10:42

Customer: Umar
Phone: +234 803 *** 4521

Shirt        4 × ₦800      ₦3,200
Trousers     2 × ₦1,000    ₦2,000
Pickup & delivery           ₦1,000
────────────────────────────────
Total                       ₦6,200
Paid (Paystack, 30 Sep)     ₦6,200
Balance                         ₦0   PAID
```

- The phone number is **masked**, because a printed receipt leaves the store.
- Adjustment lines appear with their description; per-kg lines show the measured weight (for example `Laundry by weight  3.5 kg × ₦1,500`).
- If there is a balance, the receipt shows **Balance due**; if a refund is owed, **Refund owed**; voided payments never appear.
- If a revision is awaiting approval, the receipt shows the last approved total with a note that a revised total is pending.
- The receipt number is the order number. Times are shown in the store's time zone.

### 14. Store dashboard

- **Owner** sees: orders by status, order value, confirmed payments split into online vs store-collected, outstanding balances, refunds owed.
- **Staff** see: orders-by-status counts only.
- **Attention required** (both roles, most prominent section): quotes awaiting customer approval, revised totals awaiting approval, pickup windows awaiting confirmation, payments outstanding, refunds owed. Each item links straight to the filtered orders.
- A **Today / This month** toggle applies to:
  - **Order value** = orders _created_ in the period, using the latest approved total, excluding cancelled orders.
  - **Confirmed payments** = payments _received_ in the period.
- Open-order counts, outstanding balances, and refunds owed are **live totals across all dates**.

### 15. Fluta administration

- Onboard and edit stores; set branding and subscription plans.
- Set the **store status** (Active, Paused, Deactivated) for operational reasons such as a support or fraud concern. Only Fluta admins can change it; store owners cannot pause their own store (they use closed dates for holidays).
- Record subscription invoices and payments, and cancel a subscription.
- Set each store's **online payment fee** (default 0%). Every change is audit-logged and applies only to payments made after it. Owners see their current fee in Settings → Payments.
- Per-store summaries: orders, order value, subscription status, Fluta subscription revenue, and **SMS sent this month** (counted from `MessageEvent`) to spot stores whose usage outgrows their plan.
- **Support lookups** are read-only, scoped to one store and one order/customer, require a written reason, and are audit-logged. Customer phone numbers are masked; revealing one requires a reason and is logged separately.
- No bulk customer access or export.

---

## 🗄️ Data Model (Prisma Draft)

### Entity overview

| Entity                                      | Purpose                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Store`, `ServiceArea`, `ClosedDate`        | Profile, customer-page branding, communication settings, fulfilment, schedule, per-area fixed or quoted charge                 |
| `User`, `Membership`, `StoreInvitation`     | Individual identity (Better Auth), store association, fixed role, invites                                                      |
| `Service`, `OrderLine`                      | Catalogue price and pricing unit; order-time price snapshot                                                                    |
| `Customer`, `Order`                         | Guest contact (per store), fulfilment choice, address, stage, pointer to the approved quote, tracking token, hashed booking IP |
| `QuoteRevision`                             | Proposed totals, versions, and customer approval                                                                               |
| `Payment`, `Refund`                         | Online and store-collected payments; refunds paid by the store; voids and replacements                                         |
| `StatusEvent`, `MessageEvent`, `AuditEvent` | Order history, notification history, sensitive access/change history                                                           |
| `Subscription`, `SubscriptionInvoice`       | Store plan, manual billing records                                                                                             |

### Modelling rules

- **Tenant isolation:** every store-owned table carries `storeId`, including child tables like `OrderLine` and `QuoteRevision`. Isolation in the MVP comes from four layers: server-side authorization (`getStoreAccess` + role checks), store-scoped data access (every store query takes the current `storeId`), the composite foreign keys below, and tenant isolation tests. PostgreSQL row-level security is **not** part of the MVP.
- **Cross-store links are impossible at the database level:** parents (`Order`, `Customer`, `Service`, `ServiceArea`) have `@@unique([storeId, id])`, and children reference them through both columns, e.g. `@relation(fields: [storeId, orderId], references: [storeId, id])`. A Store A payment can never point at a Store B order.
  - To clear an optional link (such as an order's service area), set the ID field to `null` directly; do not use Prisma `disconnect`, which would also try to clear `storeId`.
  - Never use `onDelete: SetNull` on these relations.
- Fluta's own billing tables (`Subscription`, `SubscriptionInvoice`) are not store data and do not follow this pattern.
- **Money** is stored as integers in minor units (kobo). Never use floats. **(Assumption)**
- **Weight** uses `Decimal`, not float.
- **One source of truth for the total:** the approved `QuoteRevision` is the only financial record of what the customer agreed to. `Order.approvedQuoteId` points to it; the order stores no total of its own. "Approved total" anywhere in this document means that revision's `total`.
- **Users are never deleted, only deactivated.** Fields like `actorUserId`, `recordedByUserId`, and `voidedByUserId` are plain IDs taken from the signed-in session (not foreign keys), and this rule keeps every "who did this" reference valid forever.
- **Snapshots:** `OrderLine` copies price, pricing type, quote-required flag, and name at order time. `QuoteRevision.linesSnapshot` freezes what the customer approved. `Order` copies the service area's name (`serviceAreaName`) and charge (`fulfilmentCharge`) when created; later area edits, disabling, or re-enabling never change existing orders.
- **Append-only history:** status events, quote revisions, payments, refunds, and audit events are never deleted or silently edited. Corrections void the wrong record and add a linked replacement, plus an audit entry.
- **Tracking tokens:** at least 128 bits of randomness; only a hash is stored; the raw token exists only in the link sent to the customer. Validity is checked from the order: token hash matches, and the order is open or was closed less than 30 days ago (or has an unpaid refund).
- **Customers** are per store (the same phone number at two stores = two separate customer records). **(Assumption)**
- **Store status and subscription status are separate** (see Monetization). `Store.status` is set by Fluta admins. Subscription `OVERDUE` and `SUSPENDED` are **derived** from invoices, never stored; only cancellation is stored (`Subscription.cancelledAt`).
- **All access decisions go through one function**, `getStoreAccess(store, subscription, now)`. No other code checks either status directly.
- Better Auth generates its own `User`, `Session`, `Account`, and `Verification` models; Fluta adds `platformRole` and `Membership`.

### Draft schema (Prisma 7.10+, validated, not final)

```prisma
// Prisma 7.10+ (never Prisma 8): the connection URL lives in prisma7.config.ts, not here.
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

// ───────────── Enums ─────────────

enum PlatformRole {
  USER
  FLUTA_ADMIN
}

enum StoreRole {
  OWNER
  STAFF
  RIDER // store's own rider: Deliveries view and its three moves only
}

// Operational status, set only by Fluta admins. Independent of billing.
enum StoreStatus {
  ACTIVE
  PAUSED
  DEACTIVATED
}

enum PricingType {
  PER_ITEM
  PER_KG
  PER_PACKAGE
}

enum AreaChargeType {
  FIXED
  QUOTE_REQUIRED
}

enum OrderChannel {
  ONLINE
  COUNTER
  PHONE
  WHATSAPP
}

enum FulfilmentType {
  DROP_OFF
  PICKUP_DELIVERY
}

enum OrderStage {
  BOOKED
  PICKUP_SCHEDULED
  PICKED_UP
  RECEIVED_BY_STORE
  QUOTE_AWAITING_APPROVAL
  IN_PROGRESS
  READY
  OUT_FOR_DELIVERY
  COMPLETED
  CANCELLED
}

enum OrderLineType {
  SERVICE // catalogue service with quantity and unit price
  ADJUSTMENT // "Others": signed amount (+ extra charge, − discount) with a description
}

enum PickupWindowStatus {
  REQUESTED
  PROPOSED_BY_STORE
  CONFIRMED
}

enum QuoteStatus {
  PENDING
  APPROVED
  DECLINED // customer declined or asked for clarification
  SUPERSEDED
}

enum PaymentSource {
  ONLINE
  STORE_COLLECTED
}

enum PaymentMethod {
  PAYSTACK
  CASH
  BANK_TRANSFER
  POS
  OTHER
}

enum PaymentStatus {
  PENDING
  CONFIRMED
  FAILED
  VOIDED // owner-voided store-collected payment; never counts in totals
}

enum ActorType {
  STAFF
  CUSTOMER
  SYSTEM
  FLUTA_ADMIN
}

enum MessageChannel {
  SMS
  EMAIL
  WHATSAPP_MANUAL
}

enum MessageStatus {
  QUEUED
  SENDING
  SENT // accepted by the provider; not proof of delivery
  FAILED
  OPENED // manual WhatsApp: staff opened the chat
  REPLACED // a newer link was issued before it was sent; final, never sent
}

enum InvoiceStatus {
  OPEN
  PAID
  VOID
}

// ───────────── Identity & access ─────────────

// Better Auth owns User, Session, Account, Verification and RateLimit (shapes
// from its CLI). Fluta only adds platformRole and the Membership relation.
model User {
  id            String       @id
  name          String
  email         String       @unique
  emailVerified Boolean      @default(false)
  image         String?
  platformRole  PlatformRole @default(USER)
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  memberships Membership[]
  sessions    Session[]
  accounts    Account[]
}

model Membership {
  id            String    @id @default(cuid())
  userId        String
  storeId       String
  role          StoreRole
  isActive      Boolean   @default(true)
  deactivatedAt DateTime?
  createdAt     DateTime  @default(now())

  user  User  @relation(fields: [userId], references: [id])
  store Store @relation(fields: [storeId], references: [id])

  @@unique([userId, storeId])
  @@index([storeId])
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ipAddress String?
  userAgent String?
  userId    String

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String // "credential" for email and password
  userId                String
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String? // Better Auth's password hash, never the password
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
}

// Better Auth's rate-limit counters (storage: "database"), keyed by IP and path.
model RateLimit {
  id          String @id
  key         String @unique
  count       Int
  lastRequest BigInt // epoch milliseconds
}

model StoreInvitation {
  id              String    @id @default(cuid())
  storeId         String
  email           String
  role            StoreRole
  tokenHash       String    @unique
  invitedByUserId String
  expiresAt       DateTime // 7 days after creation
  acceptedAt      DateTime? // single-use: set once, link then invalid
  revokedAt       DateTime? // revoked by inviter or replaced by a newer invite
  createdAt       DateTime  @default(now())

  store Store @relation(fields: [storeId], references: [id])

  @@index([storeId])
}

// ───────────── Store configuration ─────────────

// Migration adds a CHECK constraint: at least one fulfilment option on
// (dropOffEnabled or pickupDeliveryEnabled).
model Store {
  id                     String      @id @default(cuid())
  name                   String
  slug                   String      @unique // booking link on Fluta's domain: /store/{slug}
  description            String? // plain text only, rendered escaped
  addressText            String? // shown on receipts; plain text
  phone                  String?
  email                  String? // public business contact shown to customers; never used for sign-in (that's User.email)
  logoKey                String? // R2 object key generated by Fluta; never user-entered. Public URL built by getLogoUrl()
  brandPrimaryColor      String? // strictly #RRGGBB
  brandAccentColor       String? // strictly #RRGGBB
  timeZone               String      @default("Africa/Lagos")
  currency               String      @default("NGN")
  status                 StoreStatus @default(ACTIVE)
  orderPrefix            String      // 2–4 capital letters, display-only, e.g. "FF"
  nextOrderNumber        Int         @default(1001) // incremented atomically when an order is created
  dropOffEnabled         Boolean     @default(true)
  pickupDeliveryEnabled  Boolean     @default(false)
  payLaterEnabled        Boolean     @default(false)
  activeDays             Int[] // 0 = Sunday … 6 = Saturday
  openTime               String? // "08:00", store local time
  closeTime              String? // "18:00", store local time
  paystackSubaccountCode String? // null = not connected; online payment unavailable
  settlementBankName     String?
  settlementAccountName  String? // as resolved by Paystack and confirmed by the owner
  settlementAccountLast4 String? // never store the full account number
  paystackConnectedAt    DateTime?
  onlineFeeBps           Int         @default(0) // Fluta's fee on online payments, in basis points (100 = 1%), max 500
  smsEnabled             Boolean     @default(true)
  dailyBookingSmsCap     Int         @default(100) // "your order link" SMS after online bookings
  emailCopiesEnabled     Boolean     @default(true)
  whatsappContactEnabled Boolean     @default(true)
  defaultDeliveryFee     Int? // kobo; charged for areas not in the list. NULL = only listed areas, 0 = free (CHECK 0 to 100,000,000)
  createdAt              DateTime    @default(now())
  updatedAt              DateTime    @updatedAt

  memberships   Membership[]
  invitations   StoreInvitation[]
  serviceAreas  ServiceArea[]
  closedDates   ClosedDate[]
  services      Service[]
  customers     Customer[]
  orders        Order[]
  payments      Payment[]
  refunds       Refund[]
  statusEvents  StatusEvent[]
  messageEvents MessageEvent[]
  auditEvents   AuditEvent[]
  subscription  Subscription?
}

// Migration adds a CHECK constraint: charge matches charge type
// (FIXED: fixedCharge set and >= 0; QUOTE_REQUIRED: fixedCharge NULL).
model ServiceArea {
  id          String         @id @default(cuid())
  storeId     String
  name        String // trimmed
  nameKey     String // lowercase, trimmed, spaces collapsed; set by the server; enforces unique names per store
  chargeType  AreaChargeType
  fixedCharge Int? // minor units (kobo); required when chargeType = FIXED
  isActive    Boolean        @default(true)
  updatedAt   DateTime       @updatedAt

  store  Store   @relation(fields: [storeId], references: [id])
  orders Order[]

  @@unique([storeId, id]) // target for tenant-safe composite FKs
  @@unique([storeId, nameKey])
  @@index([storeId])
}

model ClosedDate {
  id      String   @id @default(cuid())
  storeId String
  date    DateTime @db.Date
  note    String?

  store Store @relation(fields: [storeId], references: [id])

  @@unique([storeId, date])
}

model Service {
  id          String      @id @default(cuid())
  storeId     String
  name        String // trimmed
  nameKey     String // lowercase, trimmed, spaces collapsed; set by the server; enforces unique names per store
  category    String?
  pricingType   PricingType
  price         Int // minor units per item / kg / package; a "from" price when requiresQuote
  requiresQuote Boolean     @default(false) // always true when pricingType = PER_KG (enforced by a CHECK constraint)
  isActive      Boolean     @default(true)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  store      Store       @relation(fields: [storeId], references: [id])
  orderLines OrderLine[]

  @@unique([storeId, id]) // target for tenant-safe composite FKs
  @@unique([storeId, nameKey])
  @@index([storeId])
}

// ───────────── Customers & orders ─────────────

model Customer {
  id        String   @id @default(cuid())
  storeId   String
  name      String
  phone     String // E.164
  email     String?
  createdAt DateTime @default(now())

  store  Store   @relation(fields: [storeId], references: [id])
  orders Order[]

  @@unique([storeId, phone])
  @@unique([storeId, id]) // target for tenant-safe composite FKs
}

model Order {
  id             String         @id @default(cuid())
  storeId        String
  orderNumber    Int // allocated from Store.nextOrderNumber in the same transaction
  customerId     String
  channel        OrderChannel
  fulfilmentType FulfilmentType
  stage          OrderStage     @default(BOOKED)
  stageBeforeQuote OrderStage? // where the order returns after quote approval

  serviceAreaId    String?
  serviceAreaName  String? // copy of the area's name at order time; shown on the order instead of the live area name
  clientRequestId  String? // one-time ID from the order form; prevents duplicate orders on double submit
  isOutsideSchedule Boolean @default(false) // staff booked a pickup outside the normal schedule (note required)
  addressText      String? // used for BOTH pickup and delivery in the MVP
  isOutOfArea      Boolean @default(false)
  fulfilmentCharge Int? // null = quote pending or not applicable
  // The customer's shared location, only for "Open in Maps" (never used for the
  // area, price, or address). Both set or both NULL (CHECK). Cleared by the
  // cron job 30 days after the order is completed or cancelled.
  pickupLatitude   Decimal? @db.Decimal(9, 6)
  pickupLongitude  Decimal? @db.Decimal(9, 6)

  requestedPickupDate  DateTime?           @db.Date
  requestedWindowStart String? // "10:00"
  requestedWindowEnd   String? // "12:00"
  scheduledPickupDate  DateTime?           @db.Date
  scheduledWindowStart String?
  scheduledWindowEnd   String?
  pickupWindowStatus   PickupWindowStatus?

  approvedQuoteId String? // the currently approved QuoteRevision; the ONLY source of the order total
  payLater        Boolean @default(false)

  trackingTokenHash     String   @unique // raw token only ever lives in the link
  trackingTokenIssuedAt DateTime

  internalNote    String?
  customerNote    String? // online bookings: the customer's "Anything else?" note, staff only, never priced
  completedAt     DateTime? // with cancelledAt, drives tracking-link expiry
  cancelledAt     DateTime?
  cancelNote      String?
  createdByUserId String? // null for online guest bookings
  bookingIpHash   String? // online bookings only; used for booking rate limits
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  store          Store           @relation(fields: [storeId], references: [id])
  customer       Customer        @relation(fields: [storeId, customerId], references: [storeId, id])
  serviceArea    ServiceArea?    @relation(fields: [storeId, serviceAreaId], references: [storeId, id])
  lines          OrderLine[]
  quoteRevisions QuoteRevision[]  @relation("OrderQuotes")
  approvedQuote  QuoteRevision?   @relation("ApprovedQuote", fields: [storeId, approvedQuoteId], references: [storeId, id])
  payments       Payment[]
  refunds        Refund[]
  statusEvents   StatusEvent[]
  messageEvents  MessageEvent[]

  @@unique([storeId, orderNumber])
  @@unique([storeId, clientRequestId])
  @@unique([storeId, id]) // target for tenant-safe composite FKs
  @@unique([storeId, approvedQuoteId])
  @@index([storeId, stage])
  @@index([storeId, createdAt])
  @@index([bookingIpHash, createdAt])
}

// Migration adds a CHECK constraint (Prisma cannot express it):
//   SERVICE:    serviceId, pricingType, unitPrice >= 0 all set; quantity > 0 and lineTotal >= 0
//               both set, or both NULL only while requiresQuote (not yet weighed/inspected)
//   ADJUSTMENT: serviceId, pricingType, unitPrice, quantity, estimatedQuantity all NULL; lineTotal set
// and a second CHECK: per-kg lines always require a quote.
// App rule: every line needs quantity and lineTotal before a priced quote is issued.
model OrderLine {
  id                String        @id @default(cuid())
  storeId           String
  orderId           String
  lineType          OrderLineType
  serviceId         String? // SERVICE only
  description       String // SERVICE: service name snapshot; ADJUSTMENT: required note
  pricingType       PricingType? // SERVICE only (snapshot)
  requiresQuote     Boolean       @default(false) // SERVICE only (snapshot)
  unitPrice         Int? // SERVICE only; price snapshot, never negative
  estimatedQuantity Decimal?      @db.Decimal(10, 3) // SERVICE only; customer's estimate, never billed
  quantity          Decimal?      @db.Decimal(10, 3) // SERVICE only; BILLED items, packages, or measured kg
  lineTotal         Int? // SERVICE: unitPrice × quantity, rounded to the nearest kobo (NULL until priced); ADJUSTMENT: the signed amount

  order   Order    @relation(fields: [storeId, orderId], references: [storeId, id], onDelete: Cascade)
  service Service? @relation(fields: [storeId, serviceId], references: [storeId, id])

  @@index([storeId, orderId])
}

model QuoteRevision {
  id               String      @id @default(cuid())
  storeId          String
  orderId          String
  version          Int
  linesSnapshot    Json
  itemsSubtotal    Int
  fulfilmentCharge Int         @default(0)
  total            Int
  reason           String?
  status           QuoteStatus @default(PENDING)
  createdByUserId  String? // null when the customer created it (online booking v1)
  createdByActor   ActorType // CUSTOMER for online bookings, STAFF for staff-created revisions (CHECK: STAFF has createdByUserId, CUSTOMER has none)
  createdAt        DateTime    @default(now())
  approvedAt       DateTime?
  approvedByActor  ActorType? // CUSTOMER via link/booking, or STAFF for in-person/phone agreement on v1
  declinedAt       DateTime?
  customerMessage  String? // clarification request from the customer

  order       Order  @relation("OrderQuotes", fields: [storeId, orderId], references: [storeId, id])
  approvedFor Order? @relation("ApprovedQuote")

  @@unique([orderId, version])
  @@unique([storeId, id])
}

// ───────────── Money ─────────────

model Payment {
  id                String        @id @default(cuid())
  storeId           String
  orderId           String
  amount            Int
  source            PaymentSource
  method            PaymentMethod
  status            PaymentStatus @default(PENDING)
  paystackReference String?       @unique
  payerEmail        String?
  flutaFeeBps       Int? // fee rate used for this online payment (copy)
  flutaFeeAmount    Int? // fee taken in kobo (copy), null for store-collected payments
  recordedByUserId  String? // staff who recorded a store-collected payment
  note              String?
  confirmedAt       DateTime?
  voidedAt          DateTime?
  voidedByUserId    String?
  voidReason        String?
  replacesPaymentId String? // the voided payment this one corrects
  createdAt         DateTime      @default(now())

  store Store @relation(fields: [storeId], references: [id])
  order Order @relation(fields: [storeId, orderId], references: [storeId, id])

  @@index([storeId, confirmedAt])
  @@index([orderId])
}

// A refund the store has actually paid. "Refund owed" is derived from the balance.
model Refund {
  id               String    @id @default(cuid())
  storeId          String
  orderId          String
  amount           Int
  note             String
  recordedByUserId String
  paidAt           DateTime
  voidedAt         DateTime?
  voidedByUserId   String?
  voidReason       String?
  replacesRefundId String? // the voided refund this one corrects
  createdAt        DateTime  @default(now())

  store Store @relation(fields: [storeId], references: [id])
  order Order @relation(fields: [storeId, orderId], references: [storeId, id])

  @@index([storeId, orderId])
}

// ───────────── History & messaging ─────────────

model StatusEvent {
  id          String      @id @default(cuid())
  storeId     String
  orderId     String
  fromStage   OrderStage?
  toStage     OrderStage
  actorType   ActorType
  actorUserId String?
  note        String?
  createdAt   DateTime    @default(now())

  store Store @relation(fields: [storeId], references: [id])
  order Order @relation(fields: [storeId, orderId], references: [storeId, id])

  @@index([orderId, createdAt])
}

model MessageEvent {
  id                String         @id @default(cuid())
  storeId           String
  orderId           String
  channel           MessageChannel
  template          String // e.g. LINK_CREATED, QUOTE_NEEDS_APPROVAL, READY, OUT_FOR_DELIVERY
  recipient         String // E.164 phone (SMS, WhatsApp) or normalized email, saved when queued
  providerMessageId String?
  status            MessageStatus  @default(QUEUED)
  body              String? // rendered message; cleared once SENT or finally FAILED (holds raw token)
  attempts          Int            @default(0)
  lastAttemptAt     DateTime? // set by each claim; SENDING older than 10 minutes may be claimed again
  lastError         String?
  sentAt            DateTime?
  createdByUserId   String?
  createdAt         DateTime       @default(now())

  store Store @relation(fields: [storeId], references: [id])
  order Order @relation(fields: [storeId, orderId], references: [storeId, id])

  @@index([orderId])
  @@index([status, createdAt]) // retry job scans QUEUED / FAILED
}

model AuditEvent {
  id          String    @id @default(cuid())
  storeId     String?
  actorType   ActorType
  actorUserId String?
  action      String // e.g. PAYMENT_CORRECTED, SUPPORT_LOOKUP, STAFF_DEACTIVATED
  targetType  String
  targetId    String?
  reason      String? // required for support lookups
  metadata    Json?
  createdAt   DateTime  @default(now())

  store Store? @relation(fields: [storeId], references: [id])

  @@index([storeId, createdAt])
}

// ───────────── Fluta subscriptions ─────────────

model Subscription {
  id               String    @id @default(cuid())
  storeId          String    @unique
  planName         String
  priceAmount      Int
  billingInterval  String    @default("MONTHLY")
  graceDays        Int       @default(7)
  currentPeriodEnd DateTime?
  // OVERDUE / SUSPENDED are derived from invoices + graceDays, never stored.
  cancelledAt      DateTime?
  cancelReason     String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  store    Store                 @relation(fields: [storeId], references: [id])
  invoices SubscriptionInvoice[]
}

model SubscriptionInvoice {
  id               String        @id @default(cuid())
  invoiceNumber    Int           @unique @default(autoincrement()) // Postgres sequence; shown as INV-000123
  subscriptionId   String
  amount           Int
  periodStart      DateTime      @db.Date
  periodEnd        DateTime      @db.Date
  dueDate          DateTime      @db.Date
  status           InvoiceStatus @default(OPEN)
  amountPaid       Int?
  paymentMethod    String? // e.g. bank transfer, recorded manually in the pilot
  paymentReference String?
  paidAt           DateTime?
  paymentNote      String?
  recordedByUserId String?
  createdAt        DateTime      @default(now())

  subscription Subscription @relation(fields: [subscriptionId], references: [id])

  @@unique([subscriptionId, periodStart]) // never two invoices for the same period
  @@index([subscriptionId, status])
}
```

---

## 💰 Monetization

- **Revenue model:** a flat **store subscription fee**, plus an optional **Fluta fee on online (Paystack) payments**, set per store by Fluta admins. It defaults to **0%** and can be changed at any time. The fee is taken from the store's share, never added to the customer's bill. It never applies to store-collected payments (cash, transfer, POS). **(Open)** Tax treatment of the fee, to confirm with an accountant before any store's rate goes above 0%.
- **SMS costs:** paid by Fluta and included in the subscription. Plan prices must cover expected SMS usage (roughly monthly orders × ~3 SMS × Termii's per-message rate). A fair-use limit or higher tier can be added later if some stores' usage outgrows their plan.
- **Payment processing:** Paystack fees are paid by the store; online payments settle into the store's own bank account through its Paystack subaccount. Fluta's fee is split out by Paystack at settlement. Fluta never holds customer money.
- **Billing (pilot):** Fluta invoices stores and records subscription payments **manually**. Each invoice has a unique number (INV-000123), and a subscription can never have two invoices for the same billing period. Recording a payment captures amount paid, method, reference, and date. Automatic billing comes later.
- **Two separate statuses** decide what a store can do:

**Store status** (operational, set only by Fluta admins, stored on `Store.status`)

| Status          | Meaning                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| **Active**      | Normal operation                                                          |
| **Paused**      | Fluta has paused the store for an operational reason unrelated to payment |
| **Deactivated** | Store closed on the platform                                              |

**Subscription status** (billing, derived from invoices except Cancelled)

| Status        | When                                                                                    |
| ------------- | --------------------------------------------------------------------------------------- |
| **Active**    | No unpaid invoice past its due date                                                     |
| **Overdue**   | Oldest unpaid invoice is past due, but within the grace period (`graceDays`, default 7) |
| **Suspended** | Oldest unpaid invoice is past due **plus** the grace period                             |
| **Cancelled** | Fluta admin cancelled the subscription (`cancelledAt` is set)                           |

A store with **no subscription record** is treated as **Suspended** (existing orders continue; no new orders). Fluta admins always create a subscription when onboarding a store, so this only guards against mistakes.

Recording payment for the overdue invoices returns the subscription to **Active** automatically; no admin action is needed. After extended non-payment (suggested 30+ days) Fluta decides manually whether to cancel the subscription and deactivate the store.

**What the system allows** is computed by `getStoreAccess` from both statuses:

| Capability                                                                    | Allowed when                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Accept new orders (online and staff-entered)                                  | Store **Active** and subscription **Active** or **Overdue**                         |
| Staff sign in and work on existing orders (stages, quotes, payments, refunds) | Store **Active** or **Paused**, and subscription not **Cancelled**                  |
| Owner edits settings, services, and staff                                     | Same as above                                                                       |
| Guests use existing tracking links (view, approve, pay)                       | Store not **Deactivated**                                                           |
| Booking page accepts bookings                                                 | Same as "accept new orders"; otherwise it shows a "not taking new bookings" message |

Examples: a store with an overdue subscription keeps working normally while Fluta follows up. A suspended subscription stops new orders, but staff finish existing ones and customers can still track and pay.

- **(Open)** Plan names, prices, and whether there are multiple tiers.

---

## 🎨 UI / UX

### Design goal

A busy laundry-store owner using Fluta for 6–8 hours a day should feel: **"I always know what is happening, what needs my attention, and what to do next."**

Within seconds of opening the dashboard, staff should see: what needs attention, which orders are active, which customers must approve something, which payments are outstanding, and the next action to take.

### Feel and visual direction

- **Calm, minimal, professional, modern, trustworthy**, fast to navigate, comfortable for long use.
- Closer to a **premium modern SaaS product** than a traditional laundry-management system. High-level inspiration only: I Hate Ironing (clean consumer laundry experience) and Fresha (modern service-business SaaS). Never copy their branding, layouts, assets, or components.
- **Clarity over density.** Whitespace is intentional; do not fill every space with cards, charts, or statistics.

| Use                                          | Avoid                                   |
| -------------------------------------------- | --------------------------------------- |
| Soft neutral backgrounds                     | Excessive gradients or glassmorphism    |
| Strong typography                            | Heavy shadows                           |
| Rounded but restrained cards, subtle borders | Huge hero sections inside the dashboard |
| Very limited shadows                         | Too many colours                        |
| Clear, subtle status badges                  | Dense tables everywhere                 |
| Comfortable spacing, large touch targets     | Decorative illustrations, gamification  |
| Simple Lucide icons                          | Excessive animation, noisy dashboards   |

### Design system and theming

- **Fluta's own look is neutral** and used everywhere staff, owners, and Fluta admins work.
- **Light and dark themes** share the same semantic tokens; **light is the default**. Store brand colours must stay readable in both.
- **Store branding** (logo, primary and accent colour) is applied only on that store's customer pages: booking, tracking, quote approval, and payment summary.
- Theme tokens as CSS variables: `primary`, `accent`, `background`, `foreground`, `muted-foreground`, `border`, `success`, `warning`, `error`, `info`.
- Stack: **Tailwind CSS + shadcn/ui + Lucide icons**.
- Status is never communicated by colour alone: every badge has a text label (and optionally an icon).

### Three separate experiences

**1. Store workspace (owners, staff, and riders)**

| Nav item   | Owner | Staff | Rider |
| ---------- | :---: | :---: | :---: |
| Overview   |  ✅   |  ✅   |  ❌   |
| Orders     |  ✅   |  ✅   |  ❌   |
| Deliveries |  ✅   |  ✅   |  ✅   |
| Customers  |  ✅   |  ✅   |  ❌   |
| Payments   |  ✅   |  ✅   |  ❌   |
| Services   |  ✅   |  ❌   |  ❌   |
| Fulfilment |  ✅   |  ❌   |  ❌   |
| Reports    |  ✅   |  ❌   |  ❌   |
| Settings   |  ✅   |  ❌   |  ❌   |

**2. Customer experience (guests, store-branded, mobile-first)**
Much simpler than the workspace. The whole journey is: **Choose → Book → Approve → Pay → Track.**

**3. Fluta admin (internal team)**
Stores, Subscriptions, Revenue, Support, store detail, and read-only order/customer lookup. Support lookup must **look** controlled: a visible "read-only investigation" banner, a required reason field before results appear, masked phone numbers (reveal one only with a reason), and a note that the access is logged.

### Key screens

**Overview (dashboard)**

- Top bar: store name, today's date, a small notification/action area, profile menu.
- **Attention required** is the most prominent section, for example: _3 quotes awaiting customer approval · 2 payments outstanding · 1 pickup window awaiting confirmation · 1 revised total awaiting approval · 1 refund owed._
- **Orders by stage** as one compact summary row, not eight large cards.
- **Financial overview (owner only)** with a Today / This month toggle: order value, confirmed payments, outstanding balances, refunds owed.
- **Recent orders**: order number, customer, order type, total, payment status, order stage, created time.

**Orders (main operational workspace)**

- Search plus filters for stage, date, order type, and payment status.
- Desktop: clean table. Mobile: stacked cards.
- Each row: order number, customer, services, total, payment status, stage, created date, pickup/delivery info.

**Order detail (one of the most important screens)**

- Header: order number, customer, stage badge, payment badge, and **one primary action** (the next stage or the pending task). "Print receipt" and "Repeat order" sit among the quiet secondary actions.
- Sections: order summary (services, quantity/weight, unit price, line totals, extra charges, discounts, approved total), customer (name, full phone with call and WhatsApp buttons, email, address), fulfilment (type, area, pickup date, requested window, confirmed window, delivery info), timeline (stage, timestamp, actor), payment history (amount, method, status, date, reference).
- Pending customer actions are shown clearly: quote awaiting approval, revised total awaiting approval, payment required, pickup confirmation required.

**Services:** list with name, category, pricing type, price, a "Quote required" badge where it applies, and active status; search and category filter; add/edit in a simple drawer; disable instead of delete.

**Fulfilment settings:** drop-off and pickup/delivery toggles, service areas (name + fixed charge or quote required), operating days, hours, and closed dates.

**Settings:** store profile, branding (with a live preview of the customer page), staff (name, email, role, status, invite, deactivate), payments (bank account connection flow and Connected state; see Core Features → Payments), customer communications (SMS, email, manual WhatsApp).

**Customers:** lightweight list and order history, with "Repeat order" on past orders (see Core Features).

**Reports (owner only):** order value, confirmed payments split online vs store-collected, outstanding balances, refunds owed. Charts only where they genuinely help.

**Customer booking flow (6 steps)**

1. **Services:** if this phone has a saved last order, show "Book the same as last time?" first. Otherwise choose services and set quantity; for per-kg services, optionally enter an estimated weight (clearly labelled as an estimate that the store will weigh).
2. **Fulfilment:** drop-off or pickup & delivery (only options the store enables).
3. **Pickup details:** service area, address, preferred date, preferred time window, with clear wording that the time is a **request, not a guaranteed slot**.
4. **Your details:** name, phone, optional email (noted as needed later if paying online), pre-filled when remembered, with a "Remember my details on this phone" checkbox and "Not you? Clear details".
5. **Review:** services, fulfilment, pickup details, contact details, the final total, or for quote-required orders an indicative total labelled "final price after the store weighs/inspects", and whether payment is needed now.
6. **Confirmation:** order number, tracking link, and what happens next, written to reassure.

**Guest order tracking:** includes a quiet "View receipt" link. Order number and current stage at the top (for example **Order #FF-1024 · In progress**), a simple progress timeline (✓ done, ● current, ○ upcoming, showing only the stages this order uses), then payment status, total, services, pickup/delivery info, messages, and any required action as a calm but prominent card (**Quote ready for your approval → Review quote**, **Payment required → Pay now**).

**Quote approval:** original amount, new amount, the difference made very obvious, reason for change, services and quantities/weights, pickup/delivery charge, new total. Actions: **Approve quote** (primary) and **Decline / request clarification** (secondary).

**Payment summary:** order number, amount due, customer info, order summary, an email field (required, pre-filled if known), and one button **Pay ₦X** that hands off to Paystack. Fluta never builds its own card-checkout screen.

### Responsive behaviour

| Desktop                                                   | Tablet                                   | Mobile                                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar navigation, spacious content, tables where useful | Condensed navigation, responsive layouts | Bottom or compact navigation, stacked cards, large touch targets, bottom sheets/drawers, no horizontal scrolling in main workflows, forms usable with one hand |

The customer experience is designed for phones first.

### UX principles

1. One primary action per screen; secondary actions stay visually quiet.
2. Avoid unnecessary confirmation dialogs.
3. Progressive disclosure for advanced settings.
4. Plain language, not technical terms.
5. Status and next action are always obvious.
6. Prefer lists and timelines over complicated dashboards; never overwhelm with analytics.
7. Opening a drawer or dialog keeps the user's context.
8. Empty states explain what to do next; every screen has loading, error, and success states.
9. Subtle interactions only: hover states, button feedback, smooth drawers, toasts, skeletons, inline validation, stage-change feedback.
10. Realistic example content, never lorem ipsum.

### Accessibility

Semantic HTML, full keyboard navigation, visible focus states, labelled fields, accessible dialogs and form errors, sufficient contrast, and no colour-only status.

### Reusable components

`AppShell`, `Sidebar`, `MobileNav`, `PageHeader`, `StatSummary`, `StatusBadge`, `PaymentBadge`, `OrderTable`, `OrderCard`, `OrderTimeline`, `OrderSummary`, `PaymentSummary`, `CustomerSummary`, `ServiceSelector`, `BookingStepper`, `QuoteApproval`, `AttentionList`, `EmptyState`, `ConfirmationDialog`, `DataTable`, `FilterBar`.

### Sample data (demos and seed data)

- Example store: **FreshFold Laundry**, used consistently everywhere.
- Services: Shirt ₦800/item · Trousers ₦1,000/item · Dress ₦1,500/item · Bedding ₦2,500/package · Laundry by weight ₦1,500/kg.
- Nigerian Naira (₦), Nigerian phone formats (for example +234 803 \*\*\* 4521), realistic but fictional Nigerian addresses. Never real people's data.

---

## 🔐 Auth Flow

Three separate access paths. Authentication is **Better Auth** (email/password, database-backed sessions); **authorization** (role + store scope) is Fluta's own code.

```text
1) STORE OWNER ONBOARDING
   Fluta admin creates Store ─► sends owner invitation (email)
   Owner opens invite ─► sets name + password ─► Better Auth user + session
   ─► Membership(role = OWNER, storeId) created ─► lands in store workspace

2) STAFF ONBOARDING
   Owner invites staff by email ─► staff accepts, sets password
   ─► Membership(role = STAFF, storeId) ─► lands in store workspace
   Owner deactivates staff ─► Membership.isActive = false + revoke their sessions
   ─► signed out immediately; every request re-checks membership; history kept

3) GUEST CUSTOMER (no account)
   Order created ─► random token generated ─► hash saved on Order
   ─► SMS link /o/{token} ─► server hashes token, loads that ONE order
   ─► can view / approve / pay for that order only
   Order completed or cancelled ─► view-only ─► link expires 30 days later
                                   (unless a refund is still owed)
   Staff resends link ─► new token + hash replaces old ─► old link stops working

4) FLUTA ADMIN
   Sign in (User.platformRole = FLUTA_ADMIN) ─► admin console
   Support lookup ─► choose store + order/customer ─► enter reason
   ─► read-only, masked phone view ─► AuditEvent written
```

**Sign-in protection:** Better Auth's built-in rate limiting is enabled for sign-in and password reset.

**Authorization checks on every store request (server-side):**

1. Valid session, or valid tracking token for guest routes.
2. Active `Membership` for the requested `storeId`, checked on **every** request, never cached in the session (or Fluta admin role for admin routes).
3. Role permits the action (see the permission table in Core Features).
4. `getStoreAccess(store, subscription, now)` permits it (for example, a suspended subscription blocks new orders).
5. Every query filtered by `storeId`.

**Invitation rules** (owner invites and staff invites alike):

- **Bound to the email:** the account always uses the invitation's email, never one from the request. A new email sets a name and password; an existing account joins with the link alone and then signs in normally. Acceptance never depends on who is signed in. (Joining grants no account access, because the password is still required. This is a recorded trade-off.)
- **Single-use:** accepting sets `acceptedAt`; the link then stops working.
- **Expiring:** invites expire after **7 days** (Assumption).
- **Revocable:** the inviter can revoke a pending invite; sending a new invite to the same email revokes the older one.
- Only a hash of the invite token is stored.

Password reset uses Better Auth's email flow via Resend.

---

## 🧠 AI Feature Flow

**Fluta has no AI features in the MVP.** No AI pricing, chatbots, auto-replies, or predictions should be built.

AI is used only as a **development tool** (see Development Workflow). Any future AI feature must be explicitly added to this document first.

---

## 🗂️ Development Workflow

- **One modular Next.js + TypeScript application** containing the web app and a **versioned HTTP API** (for example `/api/v1/...`) so a native mobile client can be added later.
- **One branch per feature or fix**, created from `staging` and merged locally into `staging` with `/feature complete` after lint, type-check, tests, and build pass. `staging` deploys to the staging site. **`main` is production** and changes only through a pull request from `staging` to `main`, opened by the project owner.
- **AI assistants** (Claude Code, Cursor, ChatGPT) can be used for implementation. They must follow this overview and `coding-standards.md`.
- **Validation:** Zod on every input boundary (forms, API, webhooks).
- **Testing:** Vitest for units, PostgreSQL integration tests (especially tenant isolation and money calculations), and a few Playwright journeys for critical flows (guest booking → quote approval → payment; staff counter order → completed).
- **Tenant isolation tests are top priority** and run against a real PostgreSQL database with two seeded stores. A Store A user must **not** be able to:
  - read, update, or cancel a Store B order;
  - see a Store B customer;
  - add a Store B service to an order;
  - use a Store B service area;
  - create a payment or refund against a Store B order.

  A Store A order's tracking link must also never return Store B data.

- **Payments:** run the Paystack test-mode checklist (see Next Steps) before any live transaction.
- **Monitoring:** Sentry for runtime errors **(Assumption, not yet in the tech decisions)**.
- **CI:** GitHub Actions can run lint, type-check, and tests on push to `staging` and on pull requests to `main` **(Optional)**.

**Branch naming example:**

```bash
git switch -c feat/guest-booking-flow
git switch -c feat/quote-revisions
git switch -c fix/refund-owed-calculation
```

### Technology choices

| Area               | Choice                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Web app and API    | Next.js + TypeScript, one modular app, versioned HTTP API                                    |
| Authentication     | Better Auth (email/password, DB sessions); Fluta handles roles and store authorization       |
| Database and ORM   | PostgreSQL + Prisma 7.10+ (not 8); store isolation via app scoping, composite foreign keys, and tests |
| Database host      | Neon (leading candidate, pending cost and region check)                                      |
| App host           | Railway (staging and production environments)                                                |
| Online payments    | Paystack with store subaccounts                                                              |
| SMS / email        | Termii (SMS pilot); Resend (official SDK) (email)                                            |
| File storage       | Cloudflare R2 Standard (public store logos)                                                  |
| UI                 | Tailwind CSS + shadcn/ui; CSS theme tokens for store branding                                |
| Validation / tests | Zod; Vitest; PostgreSQL integration tests; Playwright                                        |
| Caching            | Browser/CDN for static assets only; no Redis or shared order-data cache                      |
| Background work    | One scheduled job (host cron) that retries queued/failed messages; no separate queue service |

---

## 🧭 Roadmap

### MVP

- Assisted store onboarding by Fluta admins
- Branded booking pages with link and QR code
- Owner and staff accounts with fixed roles
- Service catalogue (per item, per kg, per package)
- Staff and guest order entry
- Pickup/delivery requests with service areas and a shared schedule
- Quotes and revisions with explicit customer approval
- Manual status updates with full history
- Online (Paystack) and store-collected payments, balances, refunds owed
- Automatic SMS and manual WhatsApp contact; optional email copies
- Printable, shareable receipts
- Store booking page as a home-screen app (store logo and name) and branded link previews
- Returning-customer conveniences: last order and details remembered on the customer's phone; staff Repeat order
- Simple owner dashboard
- Subscription administration (manual invoicing)
- Audited, read-only support access

### Later (not in the MVP)

- Self-service store signup
- Automatic subscription billing
- Automated WhatsApp messaging
- Multi-branch operations
- Richer reports and exports
- Optional customer accounts
- "Text me my orders": customer enters their phone and receives a 24-hour link listing their orders at that store (same token pattern as tracking links)
- Server-side saved addresses
- Guest session cookie (exchange the link token for a short-lived cookie so the token is not kept in the URL)
- SMS confirmation code before approving a quote or revised total
- PostgreSQL row-level security (needs a per-request transaction that sets the current store, designed to work with Prisma and Neon's connection pooling)
- Item photos
- Rider verification
- Native mobile client
- Cross-store discovery marketplace

### 🚫 Out of scope for the MVP (do not build)

Customer accounts or logins, rider assignment or tracking, guaranteed time slots or delivery promises, Fluta fees on store-collected (cash, transfer, POS) payments, automated WhatsApp, bulk customer export, multi-branch stores, self-service signup, AI features, and any marketplace between stores.

---

## ✅ Next Steps

1. **(Open)** Decide subscription plan prices and pilot success measures.
2. **(Open)** Choose pilot geography and store onboarding criteria.
3. Paystack test-mode checklist:
   - bank list, account-name resolution, and subaccount creation work end to end;
   - a transaction initialized with the subaccount and `bearer: "subaccount"` deducts Paystack's fees from the store's share;
   - webhook signatures are verified and duplicate webhooks do not double-count a payment;
   - a customer closing checkout early leaves the payment unconfirmed.
   - with a store fee above 0%, Fluta's share reaches Fluta's account and the rest reaches the store. At 0%, the store receives everything.
4. Validate Neon cost and region latency for the pilot market. Confirm the Neon project and `production` branch have no auto-delete or expiry, protect the production branch, and check the restore window for the chosen plan.
5. Register a Fluta sender ID with Termii, confirm the transactional route reaches Do-Not-Disturb numbers, and record the per-message rate for plan pricing.
6. Build a prototype, then compare Railway with Vercel Pro.
7. Onboard the first pilot stores.

### Open product questions

- After a customer **declines** a quote, how long can it wait before staff must revise or cancel?
- May a store keep a cancellation fee when cancelling a paid order?
- What exact message does the booking page show when a store is not taking new bookings?
- What do guests see on an existing tracking link after a store is **Deactivated**?
- Can staff still sign in, read-only, when the subscription is **Cancelled** but the store is not yet deactivated?

---

## 📌 Status

**Product overview ready as the MVP baseline.** Remaining before launch: subscription pricing, pilot design, and Paystack settlement validation. The Prisma schema above is a validated draft, to be finalised during development.