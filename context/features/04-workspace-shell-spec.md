# Feature 04 — Workspace Shell

**Status: Implemented.**

## Overview

The layout every store page sits in: sidebar, top bar, mobile navigation, and user menu. It replaces Feature 03's `/overview` placeholder with a getting-started view, which stays until the real dashboard arrives in Feature 20. Use the desktop and mobile reference screenshots for the shell, and the getting-started screenshot for the Overview content. Build with the Feature 01 tokens, components, and `Logo`, and reuse what Feature 03 built; everything must work in light and dark themes.

## Requirements

### Access (reuse Feature 03)

- The `(workspace)` layout **and** every page call `requireStoreMember()`; owner-only pages call it with `{ role: "OWNER" }`
- Wrap the session and membership lookup (a no-argument helper used by `requireStoreMember()`) in React's `cache()`, loading the store together with its subscription, so the layout and page share one lookup per request. The role check stays outside the cached function. Never cache across requests or in the session
- Refused pages reuse Feature 03's "You don't have access" page; Log out reuses Feature 03's sign-out
- The store, user, and role shown anywhere in the shell come from the membership returned by `requireStoreMember()`
- `getStoreAccess()` treats a missing subscription like **Suspended** (existing orders can be worked on; no new orders). Add a unit test for it if Feature 03 didn't cover it. No other subscription logic is added in this feature

### Helpers

- `src/lib/time.ts` with unit tests: format a UTC date in a given time zone; greeting by time of day (morning/afternoon/evening) in that time zone
- One booking-link helper (for example `getBookingUrl(store)`) used everywhere the link appears. It returns `/store/{slug}` on the app's base URL (`BETTER_AUTH_URL` from `env.ts`; no new variable)

### Shell

- **Sidebar (desktop):** Fluta `Logo`; "Workspace" label with the store name; nav items with Lucide icons; Settings near the bottom; user card (avatar initials, name, role) at the bottom
- Navigation items are defined once in a single config (label, path, icon, roles); the sidebar and mobile sheet filter it by the user's role. Hiding an item is UX only; every page still checks access itself
- **Nav items by role**, as in the overview's table:
  - Owner: Overview, Orders, Customers, Payments, Services, Fulfilment, Reports, Settings
  - Staff: Overview, Orders, Customers, Payments
  - Items whose feature is not built yet link to a placeholder page with the page title and "Coming soon", using the existing `EmptyState` component from Feature 01
  - Active item highlighted as in the screenshot
- **Top bar:** today's date and "Good morning/afternoon/evening, {first name}" in the **store's time zone**; notification bell (display only); user menu
- **User menu** (as in the user-menu screenshot): name, email, "Role · Store name", Store settings (owner only), Theme (Light / Dark, using Feature 01's theme switching), Log out
- **Mobile:** sidebar hidden; hamburger opens it in a sheet; layout as in the mobile screenshot, no horizontal scrolling
- Reusable components: `AppShell`, `Sidebar`, `MobileNav`, `PageHeader`, `UserMenu`

### Overview page (getting-started view)

- Page header ("Store overview" / "Welcome to your store workspace")
- Cards for store status (from `getStoreAccess`), store name, store slug, brand colour (a swatch with its hex value; Fluta stores no colour names), booking link with Copy link (via the booking-link helper), and a "Make it yours" card linking to Settings (owner only; the Settings page itself arrives in Feature 05)
- No "Configure store" button until Settings exists in Feature 05

## Decisions made during implementation

Recorded so later features keep them:

- **Store status card:** when several statuses apply, it shows the most restrictive, in the order Paused → Suspended → Overdue → Active. Overdue is shown to owners only; staff see Active, and Suspended reads "Not taking new bookings" for staff
- **Missing subscription** is treated as Suspended (changed from Feature 03's Cancelled by decision; its test was updated)
- **Greeting and date** live in a small client component that receives the store's time zone, renders the server value first, then recomputes after load and every few minutes, so an open tab never shows a stale greeting or yesterday's date
- **Invalid store time zone:** `time.ts` falls back to `Africa/Lagos` and logs a warning. Validation when the time zone is set belongs to Feature 23
- **Brand colour swatch** is an SVG fill (no inline style); a missing or invalid colour shows "Not set"
- **Notification bell** is not a button, is not focusable, and is hidden from screen readers
- **User menu** is in the top bar only; the sidebar user card is not clickable and has no chevron or "…"
- **Logo link** is labelled "Fluta, go to Overview"
- **`ComingSoon` placeholders** take an `href` typed from the navigation config, so a mismatch fails type-checking
- **Booking link** uses `/store/{slug}` (see the overview); always built with `getBookingUrl()`, never by hand

## Not in this feature

- Real dashboard figures, recent orders, orders by status (Feature 20)
- Orders count badge in the sidebar (Feature 10)
- The customer booking page at `/store/[slug]` (Feature 13). Show Copy link only; no Preview or Open button until then.
- Store settings and branding forms (Feature 05)
- The Fluta admin area beyond Feature 03's `/admin` placeholder (Feature 23)

## Done when

- Greeting and date are correct across time zones (unit tests in `time.ts`)
- Owner and staff see their correct nav items; staff opening an owner-only page get the no-access page, checked by the page itself, not only the layout
- The layout and page share one session/membership lookup per request; a deactivated membership is still refused on the next request
- Works at 360px wide and on desktop, in light and dark themes; keyboard navigation and visible focus work in sidebar and menus
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as owner and as staff, at ~360px and desktop, light and dark: sidebar items, active highlight, mobile sheet, user menu, theme switch, Log out; staff opening `/settings` see the no-access page; Copy link copies the booking URL
- **Next.js DevTools:** no runtime or build errors on the workspace routes
- **Neon MCP** (`development`, read-only, optional): store name and status shown match the seeded data

## References

- @context/screenshots/customer-desktop-reference.png
- @context/screenshots/customer-mobile-reference.png
- @context/screenshots/workspace-getting-started.png
- @context/screenshots/user-menu.png
- @context/project-overview.md (UI / UX, Staff accounts and roles)
- @context/features/01-foundation-design-system-spec.md
- @context/features/03-auth-access-spec.md
