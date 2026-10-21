# Feature 13 — Customer Booking

## Overview

Customers book with a store through its public link, `/store/{slug}`, without an account: choose services, choose drop-off or pickup, give their details, and confirm. The page wears the store's own branding. Customers can also add it to their phone's home screen as an app with the store's logo and name, and the link shows a branded preview when shared on WhatsApp.

This is Fluta's first public page. It reuses Feature 09's order creation and pricing rules, Feature 07's fulfilment rules, and Feature 05's branding.

## Requirements

### The public page

- `/store/{slug}` needs no sign-in. The store comes only from the slug in the address
- An unknown slug, or a **Deactivated** store, shows a plain "This store isn't available" page (HTTP 404)
- A store that isn't accepting new orders (per `getStoreAccess`) still shows its page and services, with the message "{Store name} isn't taking new bookings right now. Please contact the store." and no booking button. **(Assumption)** The exact wording is (Open) in the overview
- A store that can't take any online booking shows one clear state, with no booking form: "This store isn't taking online bookings right now. Please contact the store." This applies when the store has no active services, or when no fulfilment option is currently possible (drop-off turned off and pickup unavailable). If only pickup is unavailable, only drop-off is offered
- The page uses the store's logo (`getLogoUrl`), name, description, and colours (`getBrandTheme`), in light or dark theme following the phone's setting
- Booking pages **may be listed by search engines**, so customers searching for the store can find it. (Tracking pages are hidden from search in Feature 14.)
- Every price, area, and window shown comes from this store's data on the server
- Customer-facing text never uses internal terms like "quote required", "revision", or "fulfilment". It says what happens in plain words (see the coding standards)

### The six steps

One page with a step indicator, mobile-first, with Back and Continue on every step. Answers are kept when moving between steps.

1. **Services:** active services only, with `formatServicePrice`. Per-item and per-package: quantity 1 to 999. Per-kg: an optional estimated weight, clearly labelled "Your estimate. The store will weigh it." At least one service is required
2. **Fulfilment:** only the options the store has enabled. Pickup and delivery is offered only when `isPickupAvailable` is true
3. **Pickup details** (pickup only):
   - Service area from active areas, showing each area's charge: "₦1,500", "Free", or "The store will confirm this price"
   - Address, required, up to 200 characters
   - Date: today through **14 days after today, inclusive** (15 dates in total), in the store's time zone, on active days only, never on a closed date. Online bookings never get the staff "Outside normal schedule" option
   - Window from `getPickupWindows`, in 12-hour format. Windows that start **less than 2 hours from now** are not offered
   - The wording makes clear the time is a **request**, not a guaranteed slot
4. **Your details:** name (2 to 80 characters), phone (required, via `phone.ts` with `"NG"` as the default country), and email (optional, via `normalizeEmail`). Fields use the right `autocomplete` attributes (`name`, `tel`, `email`, `street-address`) so the phone can fill them
5. **Review:** services, fulfilment, pickup details, and contact details, with:
   - Whether the order is fully priced is decided by `isOrderFullyPriced` (Feature 09), which counts both unweighed items and a pickup price the store will confirm
   - A fully priced order: its **total**
   - An order that needs a price from the store, where **every part can be estimated** (each per-kg line has the customer's estimate, quote-required items use their "from" price, and the pickup charge is fixed): **"Estimated total: ₦X"** with "Final price after the store weighs or inspects your items"
   - Anything still unknown (a per-kg line without an estimate, or a pickup price the store will confirm): **no number**, only "The store will confirm the final price after checking your items." Never a partial sum
   - The pickup and delivery charge: "₦1,500", "Free", or "Pickup & delivery: the store will confirm this price after you book"
6. **Confirmation:** the order number, a short summary, and what happens next, written to reassure ("We've received your booking. {Store name} will confirm your pickup time.")

### Creating the order (reusing Feature 09)

- Online orders use the **same order-creation service** as Feature 09, with `channel = ONLINE` and no staff user. No second creation path
- **Idempotency:** the booking form sends a UUID `clientRequestId` generated when the page opens. A repeated submission returns the same order, exactly as in Feature 09
- **Re-checked at submission:** the server re-checks the pickup date and window (still at least 2 hours away in the store's time zone, within the 15-date range, on an active day, not a closed date), that the window is one of the store's windows from `getPickupWindows`, that pickup is still available (`isPickupAvailable`), that the area and services are still active, and that the store still accepts bookings. If any check fails, nothing is created and the customer returns to the affected step with their answers kept, and a plain message such as "That pickup time is no longer available. Please choose another." What the page offers is only a convenience. The server's check is what counts
- **The server builds every price** from the store's catalogue and areas. The browser sends only service IDs, quantities or estimates, the fulfilment choice, the area, the date, the window, and contact details
- The customer is found or created by store and phone (Feature 09's rule)
- For an existing customer, a booking never overwrites their name, phone, or email. The only exception: if they have no email yet, the one entered is saved. This stops anyone from typing someone else's phone number to redirect their receipts and links
- The booking page never shows a customer's saved details when a phone number is entered, so it can't be used to look up who owns a number
- **Version 1** has `createdByActor = CUSTOMER` and no user:
  - Fully priced: approved at once by the customer confirming the booking (`approvedByActor = CUSTOMER`), and `approvedQuoteId` points to it
  - Needs a quote: the estimate, never approved, labelled "Estimate" as in Feature 10
- **Starting stage** for every online order is **Booked**, through `getInitialStage`
- **Pickup orders:** the requested date and window are saved with `pickupWindowStatus = REQUESTED`. A fixed area's charge is copied to the order. A quote-required area leaves the charge empty for staff to set through a revision (Feature 12, from Booked)
- **Payment:** there is no payment step yet. Every online order is created as pay later (`payLater = true`). Feature 17 adds "Pay now" for stores connected to Paystack
- **Tracking link:** the order's token hash is stored as usual. The link itself is shown on the confirmation page once Feature 14 builds the tracking page

### Booking limits (from the overview)

- At most **5 online bookings per phone number per store in 24 hours**, and **20 per IP address per hour across all stores**, counted from recent orders in PostgreSQL
- **Order of checks:** first, if this request ID already created an order, return that order. Then apply the booking limits. Then create the order
- **Limits hold under simultaneous submissions:** inside the booking's transaction, take a short database lock for the store and phone number, and another for the IP hash, before counting. Simultaneous bookings from the same phone or IP are handled one at a time, so none can slip past the limit. Different customers never wait on each other
- The client IP comes from **one shared helper** that reads only the header set by the trusted host (as configured for Better Auth in Feature 03), never a header the visitor could fake. Booking and Better Auth both use it
- The IP is stored only as an **HMAC hash** with a secret, `BOOKING_IP_SECRET` (new, in `env.ts` and `.env.example`). A plain hash isn't enough, because every IP address can be guessed and hashed
- IP hashes are never kept longer than needed. Each online booking also clears `bookingIpHash` on that store's orders older than 24 hours, in the same transaction. Feature 15's scheduled job will sweep any remaining ones
- A blocked booking shows: "Too many bookings from this number or connection. Please try again later or contact the store." Nothing is created
- Staff-entered orders have no limit

### Home-screen app (one per store)

- A web app manifest per store with the store's name (a short name of at most 12 characters for the icon label), start page and scope `/store/{slug}`, standalone display, and theme colours from the store's brand (or Fluta's defaults)
- Icons generated by Next.js from the logo on the brand colour, in the sizes phones need, including an Apple touch icon. A store without a logo gets its initials on its brand colour, or on Fluta's default colour if none is set
- No offline mode, no push notifications, no app store
- On phones, a small "Add to Home Screen" hint appears once, adapted to the phone: on Android it uses the browser's install prompt when available, and on iPhone (which has no prompt) it shows "Tap Share, then Add to Home Screen". Dismissing it is remembered in the phone's browser storage, wrapped in error handling so the page works when storage isn't available
- Icons and preview images use **only** the store's own saved logo (from `logoKey`), never an address passed in the page link, so nobody can make Fluta's server fetch an address of their choosing

### Link previews

- The booking page has preview information for WhatsApp, Facebook, and text messages: the store name, a short line (the store description, or "Book your laundry with {store name}"), and an image generated from the logo and brand colour
- A Deactivated store's link shows no store details in its preview

## Not in this feature

- The tracking page, quote approval, and confirming or proposing pickup windows (Feature 14)
- SMS and email messages (Feature 15)
- Online payment (Feature 17)
- "Book the same as last time" and remembered details on the phone (Feature 22)
- Customer accounts or sign-in

## Done when

- Unit tests: date options (today through 14 days after today inclusive, 15 dates, active days, closed dates, store time zone), the estimated total shown only when every part can be estimated and no number otherwise, windows starting less than 2 hours from now removed, indicative total from estimates, IP HMAC hashing, short-name shortening
- Integration tests:
  - a fully priced booking creates an order at Booked with an approved version 1 by the customer, and a quote-required booking creates an unapproved estimate
  - a pickup booking saves the requested window with status Requested, copies a fixed area's charge, and leaves a quoted charge empty
  - a request that sends its own prices or charges is ignored
  - a service or area from another store, or a disabled one, is refused
  - the 6th booking from one phone at one store in 24 hours is refused, and the 21st from one IP in an hour across stores is refused, with nothing created
  - 10 simultaneous bookings from one phone at one store create exactly 5 orders
  - a booking clears `bookingIpHash` on that store's orders older than 24 hours
  - an existing customer's name and email are kept when different ones are entered, and an empty email is filled in
  - resubmitting the 5th booking with the same request ID returns the existing order instead of being refused
  - a repeated submission with the same request ID returns the same order
  - a store not accepting new orders shows the message and refuses bookings, and a Deactivated store returns 404
  - pickup is not offered when `isPickupAvailable` is false
  - a store with no active services, or with drop-off off and pickup unavailable, shows the "isn't taking online bookings" state and refuses bookings
  - each store's manifest, icons, and preview carry only that store's name and branding
  - a window that has become less than 2 hours away by submission, or a date closed while the form was open, is refused with nothing created
  - a pickup request with a made-up window time, or sent after the owner switched pickup off, is refused with nothing created
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as a customer at ~360px and desktop, light and dark:
  - book a fixed-price drop-off and a quote-required pickup end to end
  - see the store's logo, name, and colours throughout
  - see windows less than 2 hours away hidden, and closed dates unavailable
  - submit twice quickly and get one order
  - see the "not taking new bookings" message on a suspended store
  - check the manifest, icons, and the Add to Home Screen hint on a phone-sized screen
  - check the link preview information on the booking page
- **Next.js DevTools:** no runtime or build errors on `/store/[slug]`
- **Neon MCP** (`development`, read-only): online orders have channel Online, no staff user, a customer-created version 1, the requested window, and a hashed IP

## References

- @context/project-overview.md (Order intake, Online booking limits, Store workspace and branding → home-screen app and link previews, Customer booking flow, Fulfilment)
- @context/coding-standards.md (Security, Styling → brand colours)
- @context/features/05-store-settings-branding-spec.md (`getBrandTheme`, `getLogoUrl`)
- @context/features/07-fulfilment-settings-spec.md (`getPickupWindows`, `isPickupAvailable`)
- @context/features/09-staff-order-entry-spec.md (order creation, pricing, idempotency)
