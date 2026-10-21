# Feature 05 — Store Settings & Branding

## Overview

Owners keep their store profile accurate, share their booking link and QR code, and set the colours and logo customers will see. Replaces Feature 04's `/settings` placeholder. Matches the store settings screenshot. Reuses Feature 03's access helpers and Feature 04's booking-link helper and status logic.

## Requirements

### Access (reuse Feature 03)

- `/settings` is owner-only: the page calls `requireStoreMember({ role: "OWNER" })`; staff get Feature 03's no-access page
- **Every Server Action** also calls `requireStoreMember({ role: "OWNER" })` itself (each action is a separate request)
- The store being changed comes **only** from the membership, never from form data or any other client input
- A refused or invalid action returns an error result (never a success), shown as an error toast
- Data access through `src/server/data/stores.ts`, scoped by `storeId`

### Store information

- Fields and limits (validated with Zod on the server):
  - Name: required, 2–80 characters
  - Description: optional, plain text, up to 300 characters
  - Address: optional, up to 200 characters
  - Phone: optional; validated and stored in E.164 via `phone.ts`
  - Email: optional; the store's contact email (not a login)
- Save and Cancel as in the screenshot; Cancel restores the saved values; success and error toasts
- **Store slug** shown **read-only**, with "Contact Fluta to change your link" (owners never edit it; Fluta admins do in Feature 23)
- **Time zone** is not shown or editable here (Fluta admins set it in Feature 23)
- `src/lib/phone.ts` with unit tests: normalise to E.164 and mask ("+234 803 *** 4521"); accepts valid international numbers
  - It takes the default country as an explicit argument and never assumes one on its own. For the store phone, the caller passes `"NG"`, so a number without a country code (e.g. `0803…`) is read as Nigerian

### Customer booking

- Booking link from Feature 04's `getBookingUrl()` (`/store/{slug}`), with Copy
- QR code for **exactly** that link, with Download PNG
- Status badge reuses Feature 04's store status logic (same precedence, owner wording)
- If Feature 04's store status logic (precedence and wording) lives inside the overview card, first extract it into one shared helper used by both the overview and settings
- No Preview or Open button until the booking page exists (Feature 13)

### Branding

- Primary and accent colours, saved only as `#RRGGBB` (Zod on save, re-checked before render)
- Text colour on brand-coloured elements chosen automatically (dark or light) for WCAG AA contrast
- Brand colours only override the `primary` and `accent` tokens on customer pages, and must stay readable in light and dark themes
- One brand-theme helper builds the validated CSS variables; it powers the live preview now and the customer layout from Feature 13
- **Live preview** of the customer page header (logo, store name, primary button) with the chosen colours, shown in both light and dark themes side by side
- **Logo upload** to Cloudflare R2:
  - PNG, JPEG, or WebP only; max 1 MB; type checked from the file's first bytes (no extra package needed), not its name or claimed type; no SVG
  - Maximum 2000 × 2000 pixels, read from the file header without decoding the image (a small header-reading package is an Ask First item if needed)
  - Fluta generates the object key and stores **only the key** in `Store.logoKey` (never user-entered). The public address is built by one helper, `getLogoUrl(store)`, from `R2_PUBLIC_URL` + the key; logo addresses are never stored or built by hand
  - Replace: upload the new file, save the new `logoKey`, then delete the old file
  - Remove: clear `logoKey`, then delete the file
  - A failed delete of an old file is logged, never shown as a failed save
  - If saving `logoKey` fails after an upload, delete the newly uploaded file; log any cleanup failure
  - R2's public address added to Next.js image allowed sources

### Workspace overview

- Add Feature 04's deferred **Configure store** button to the overview, linking to `/settings` (owner only)

### Schema change (Ask First)

- Replace `Store.logoUrl` with `Store.logoKey` (`String?`) in one migration. Check first that no store has a `logoUrl` value; if any do, convert them to keys in the migration

### New dependencies and environment (Ask First)

- Propose, with reasons, before installing: an S3-compatible client for R2, a QR code generator, and a phone-number parsing package (for example `libphonenumber-js`)
- New variables in `env.ts`, `.env.example`, `.env.local`, and `.env.test`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`
- Development and test use their own bucket, never production's; tests use a fake R2, never a real bucket

## Not in this feature

- The customer booking page at `/store/[slug]` (Feature 13)
- Payments / Paystack connection (Feature 17)
- Communication toggles (Feature 15)
- Slug and time-zone editing (Fluta admin, Feature 23)

## Done when

- Unit tests: phone normalisation and masking (Nigerian and foreign numbers, numbers without a country code); colour validation; contrast choice for light and dark brand colours; file-type check from bytes
- Integration tests: staff cannot save settings; a FreshFold owner cannot change CleanWave, even by sending CleanWave's ID in the form; invalid values are rejected and nothing is saved
- Logo tests (fake R2): oversized, wrong-type, and over-2000-pixel files rejected; replacing deletes the old file; removing clears `logoKey` and deletes the file; a failed save leaves no uploaded file behind
- The QR code encodes the same link as Copy
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass

## Verify with

- **Playwright MCP:** as owner at ~360px and desktop, light and dark: edit and save store information, Cancel restores values, colour changes update both light and dark previews, logo upload/replace/remove, Copy link, QR download; staff opening `/settings` see the no-access page; Configure store appears for owners only
- **Next.js DevTools:** no runtime or build errors on `/settings` and `/overview`
- **Neon MCP** (`development`, read-only): saved values, E.164 phone, `#RRGGBB` colours, and `logoKey` match what was entered

## References

- @context/screenshots/store-settings.png
- @context/project-overview.md (Store workspace and branding, UI / UX)
- @context/coding-standards.md (Security, Styling)
- @context/features/03-auth-access-spec.md
- @context/features/04-workspace-shell-spec.md (including "Decisions made during implementation")
