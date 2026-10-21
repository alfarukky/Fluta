# Feature 15b — Location and Default Delivery Fee

## Overview

Two small additions for pickup and delivery. Customers can share their **current location** when booking, so staff and riders get an "Open in Maps" button that leads straight to them. And stores can set an optional **default delivery fee**, so customers outside the listed areas can still book online at a known price. Stores that don't set a default fee see no change.

It updates Feature 07 (fulfilment settings and `isPickupAvailable`), Feature 09 (staff order entry), Feature 10 (orders list and detail), Feature 13 (booking), and Feature 14b (Deliveries view).

## Requirements

### Schema change (Ask First)

One migration:

- `Order.pickupLatitude` and `Order.pickupLongitude` (`Decimal(9, 6)`, optional)
- `Store.defaultDeliveryFee` (`Int`, optional, in kobo). Empty means no default fee is offered

### What these additions never do

- **Coordinates are only for navigation.** They are never used to decide the area, price, distance, address, or whether pickup is available
- **The default fee only answers "is this area served".** It never bypasses pickup being turned on, the schedule, closed dates, the 15-date booking range, or the 2-hour rule. Every existing pickup rule still applies

### 1. "Use my current location" (booking page)

- In the pickup details step, next to the address field: **"Use my current location"**
- The phone is asked for permission **only when the customer taps the button**, never when the page loads. If allowed, the coordinates are saved with the booking, and the page shows "Location added to help find your address" with **Remove**
- **Remove** clears the coordinates from the booking, so none are sent
- The customer still types their address. **The typed address is always the real one.** Coordinates only help find it
- If permission is refused, location is unavailable, or it takes too long, the page shows "Couldn't get your location. Please type your address." and booking continues normally
- No automatic address fill-in, and no location lookup service
- The server accepts coordinates only if both are real, finite numbers (not "not a number" or infinity), with latitude from −90 to 90 and longitude from −180 to 180, and rounds them to 6 decimal places before saving. Anything else is ignored. They are optional and never block a booking

### 2. "Open in Maps" (staff and riders)

- On the order detail page (Feature 10) and on Deliveries cards (Feature 14b), orders with coordinates show **Open in Maps**, a plain link to Google Maps at that spot (no API key)
- Every Open in Maps link is built by one helper, `getGoogleMapsUrl(latitude, longitude)`, returning `https://www.google.com/maps/search/?api=1&query={latitude},{longitude}`
- The Deliveries data function from Feature 14b returns the coordinates for this button

### Privacy for coordinates

- An exact location is sensitive. Coordinates are shown only to owners, staff, and riders of that store
- Never anywhere else: not in SMS, email, or WhatsApp text, message records, the tracking page or the data it receives, link previews, or logs. The tracking page doesn't even reveal whether a location was shared
- The logger's redaction list gains `latitude` and `longitude`
- **Kept only while needed:** coordinates are useful only while the store may still need a pickup or delivery. Feature 15's scheduled job also clears `pickupLatitude` and `pickupLongitude` on orders completed or cancelled more than **30 days** ago (matching the tracking link's lifetime). The typed address stays with the order. If an order is reopened after that, "Open in Maps" is no longer shown, and staff use the address and phone

### 3. Default delivery fee (Fulfilment settings)

- In Fulfilment settings, an optional **"Default pickup & delivery fee"** with the help text: "Charged when a customer's area isn't in your list. Leave empty to only accept listed areas." Entered with `parseNairaToKobo`, from ₦0 to ₦1,000,000. Empty means no default fee, so no "My area isn't listed" option. **₦0 is a set fee** ("Free"), not the same as empty. Saving uses Feature 07's shared edit check
- Changing or removing it never changes existing orders, which keep their own copy of the charge

### 4. "My area isn't listed" (booking page)

- When the store has a default fee, the area list gains **"My area isn't listed"**, with the default fee shown as its price
- Choosing it asks the customer to type their area name (required, 2 to 60 characters)
- The order is created out of area: `isOutOfArea = true`, no `serviceAreaId`, the typed name as `serviceAreaName`, and the default fee copied as `fulfilmentCharge`. The order counts as fully priced for its delivery charge, as with a fixed area
- The server re-checks at submission that the default fee is still set, using its current value
- Stores without a default fee show no "My area isn't listed" option, as today

### 5. `isPickupAvailable` (updates Feature 07)

- Pickup can be booked when pickup and delivery is on, the schedule is valid, **and** there is at least one active area **or** a default fee
- Feature 07's warning ("customers can't book pickup yet") follows the same rule

### 6. Staff order entry (updates Feature 09)

- When staff choose "Outside our service areas" and the store has a default fee, the charge is pre-filled with it. Staff can still change it

### 7. "Outside our service areas" badge

- Out-of-area orders show an **"Outside our service areas"** badge in the orders list, on the order detail page, and on Deliveries cards, so staff notice them straight away
- Feature 20 adds these orders to the dashboard's "Attention required" list

## Not in this feature

- Automatic address fill-in from coordinates, or any location lookup service
- Maps inside Fluta, area boundaries, distance-based pricing, or rider tracking
- Staff capturing a customer's location for staff-entered orders
- Notifications to staff (the badge and Feature 20's attention list serve this)

## Done when

- Unit tests: coordinate checks (ranges, not-a-number and infinity ignored, rounding to 6 decimal places), `getGoogleMapsUrl`, `isPickupAvailable` with an active area, with only a default fee (including ₦0), and with neither
- Integration tests:
  - a booking with coordinates saves them, and one without works normally
  - out-of-range coordinates are ignored and never block the booking
  - coordinates never appear in SMS, email, or WhatsApp text, message records, the tracking page or its data, link previews, or logs
  - a ₦0 default fee shows "My area isn't listed: Free" and makes pickup available
  - the scheduled job clears coordinates on orders completed or cancelled more than 30 days ago, and keeps the typed address
  - with a default fee, "My area isn't listed" creates an out-of-area order with the typed name and the fee copied, fully priced for its charge
  - without a default fee, the option isn't offered and such a request is refused
  - a default fee removed while the form was open is caught at submission
  - changing the default fee leaves existing orders unchanged
  - a store with a default fee and no areas can take pickup bookings
  - staff out-of-area orders pre-fill the default fee
  - the badge appears on out-of-area orders in the list, detail, and Deliveries view
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** at ~360px and desktop, light and dark:
  - book with "Use my current location" allowed, then refused
  - as staff and as a rider, use Open in Maps
  - set a default fee, book with "My area isn't listed", and see the badge on the order
  - remove the default fee and confirm the option disappears
- **Next.js DevTools:** no runtime or build errors on `/store/[slug]`, `/fulfilment`, `/orders`, and `/deliveries`
- **Neon MCP** (`development`, read-only): coordinates, out-of-area flag, area name, and charge saved as expected

## References

- @context/project-overview.md (Fulfilment, service areas, and scheduling)
- @context/features/07-fulfilment-settings-spec.md (`isPickupAvailable`, edit check)
- @context/features/09-staff-order-entry-spec.md (out-of-area orders)
- @context/features/13-customer-booking-spec.md (pickup details, re-checks at submission)
- @context/features/14b-deliveries-and-rider-role-spec.md (Deliveries data function)
