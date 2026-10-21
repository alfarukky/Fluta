# Feature 13b — Booking Improvements

## Overview

Three small improvements to the customer booking page from Feature 13, found while checking it in the browser: easier quantity entry, a way for customers to mention items that aren't listed, and guidance for writing a complete pickup address. Nothing about how orders are priced or created changes.

## Requirements

### 1. Quantity stepper

- One shared **quantity stepper** component: − [ 2 ] +, with buttons at least 44 pixels so they're easy to tap
- Used for per-item and per-package quantities on the booking page (Feature 13)
- Limits 1 to 999. − is disabled at 1, because Remove takes an item off. The number can still be typed for larger amounts
- Per-kg estimates keep their typed field, because weights need decimals
- The component is built so the staff order form and quote editor can adopt it later, but they are not changed in this feature

### 2. "Anything else?" note

- On the services step, an optional free-text box: **"Anything else? Other items or instructions"**, for example "2 curtains, 1 rug" or "please iron the shirts only". Up to 300 characters, plain text
- Saved on the order as `customerNote`. An empty note is stored as `NULL`
- Shown to staff on the order detail page (Feature 10), labelled as the customer's note, as escaped plain text. Never shown to anyone else
- **Never priced automatically.** Staff price anything extra through the normal quote flow (Feature 12), which the customer approves
- If the customer wrote a note, the review step adds: "The store may update your price after reading your note."

### 3. Address guidance

- Under the pickup address field: "Include house number, street, area, and a nearby landmark."
- An example inside the empty box: "12 Admiralty Way, Lekki Phase 1, near Mega Plaza"
- If the address looks too short (under 20 characters, or fewer than three words), a gentle warning appears: "This address looks short. Add a house number, street, or landmark so the store can find you." It **never blocks** continuing

### Schema change (Ask First)

- Add `Order.customerNote` (`String?`) in one migration

## Not in this feature

- Changing the staff order form or quote editor to use the stepper
- Turning the customer's note into priced lines automatically
- Address lookup, maps, or blocking short addresses

## Done when

- Unit tests:
  - the stepper's limits (1 to 999, − disabled at 1, typing still allowed)
  - the short-address warning (shown under 20 characters or fewer than three words, never blocking)
- Integration tests:
  - a booking with a note saves it as `customerNote`, it appears on the staff order detail, and it never changes the total
  - an empty or whitespace-only note is stored as `NULL`
  - a note over 300 characters is refused
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as a customer at ~360px and desktop, light and dark: use + and − on a per-item service, type a larger number, leave a note and see the review message, enter a short address and see the warning, then continue anyway and book. As staff, see the note on the order detail
- **Next.js DevTools:** no runtime or build errors on `/store/[slug]` and `/orders/[id]`
- **Neon MCP** (`development`, read-only): `customerNote` saved as entered, or `NULL` when empty

## References

- @context/features/13-customer-booking-spec.md
- @context/features/10-orders-list-and-detail-spec.md (order detail page)
- @context/coding-standards.md (plain customer wording, text inputs trimmed and empty stored as `NULL`)
