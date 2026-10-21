# Feature 15c — Brand Logo and Sign-in Page

## Overview

Fluta gets its real logo, replacing the text placeholder from Feature 01, in every place Fluta's own brand appears. The sign-in page gets a polished look with a slight, calm animation. Store branding on customer pages is unchanged: there, each store's logo stays the star, and Fluta appears only as a small "Powered by Fluta".

## Inputs

- **Logo reference:** `context/brand/fluta-logo.jpeg`, the chosen logo, showing every version (full lockup, symbol only, reversed white, symbol only white, single colour black). Redraw it faithfully as clean SVG, following the brief below
- **Animation reference:** Termii's sign-in page, `https://app.termii.ai/auth/signin`. Open it with the Playwright MCP at desktop and mobile widths and study its motion: what moves, how slowly, how it enters, and how subtle it is. Take the feel, never the design, colours, or assets

## Requirements

### 1. The logo

**The brief:**

- The feeling of a **neatly folded garment and a calm, flowing motion** at the same time: order and ease
- A simple **symbol**: a capital "F" made of three soft, leaf-like folds stacked on a shared left edge (a long top fold sweeping up to the right, a shorter middle fold, a small bottom fold), inside a softly rounded square
- A **wordmark**, "fluta" in lowercase, in a clean modern sans-serif with slightly rounded edges, medium weight, slightly tight spacing
- **Colours:** forest green `#173C32` (the `primary` token) and a soft mint tint for the rounded square's background. A reversed version for dark backgrounds: a white rounded square with the forest-green folds, and a white wordmark
- **Avoid:** washing machines, bubbles, hangers, water splashes, sparkles, gradients, shadows, and fine detail that disappears at small sizes. The reference shows a soft gradient inside the folds; the SVG draws them in flat forest green

**Versions, built as SVG:**

1. Full lockup: symbol and wordmark side by side
2. Symbol only, for small spaces
3. Reversed (white) versions of both, for dark backgrounds and dark theme
4. A single-colour black version, for print and receipts later

**Rules:**

- The symbol must stay recognisable at **16 pixels** (browser tab icon) with the wordmark removed
- Colours come from theme tokens where the logo is drawn in the page, so it follows light and dark themes automatically
- Each version has an accessible name ("Fluta")

### 2. Where the logo appears

Update the existing `Logo` component from Feature 01, so everything using it changes in one place, with a `variant` option (full, symbol, reversed) and sizes:

- Workspace sidebar and mobile menu (Feature 04)
- Sign-in page, password reset pages, and the invitation page (Features 03 and 08)
- Fluta admin placeholder pages
- Browser tab icon and Fluta's own app icons, from the symbol, replacing the current `favicon.ico` in `public/`. These apply only to Fluta's own pages. Store booking and tracking pages keep their store's icons (Feature 13)
- Emails sent by Fluta (Feature 08's invitations and password reset, Feature 15's copies): a small PNG of the logo at the top, served from Fluta's own address, with "Fluta" as its alternative text. Store-related emails show the store's name first, as now
- Customer pages: a small, quiet **"Powered by Fluta"** with the symbol in the footer only, in muted text, next to a **"Privacy"** link to `/privacy`. It never competes with the store's logo
  - `/privacy` is a simple public page that shows the privacy notice. Its wording is provided by the project owner, not written by the AI. Until it is provided, the page shows "Our privacy notice is coming soon. Contact us at {FLUTA_ALERT_EMAIL} with any questions."

### 3. The sign-in page

Keep Feature 03's layout and behaviour (brand panel on the left, form on the right, generic error message, rate limiting), and make it feel polished:

- **Brand panel (desktop):** the full logo, a short line such as "Your laundry business, calmly organised", and a **slow, subtle background animation** in the spirit of the reference. For example soft forest-green and mint shapes drifting or folding gently, echoing the logo's folds. It should be barely noticeable, never distracting
- **Form side:** the form and logo fade and rise slightly into place once when the page loads (a short, gentle entrance), then stay still
- **Mobile:** the brand panel is hidden as now. The logo sits at the top of the form with the same gentle entrance. Optionally a very light version of the background motion behind the form, only if it stays readable
- Works in light and dark themes, using theme tokens

### 4. Animation rules

- **Calm:** slow movement (many seconds per cycle), low contrast, no flashing, no bouncing
- **Reduced motion:** when the user has turned motion off on their device, no animation runs at all. The page shows the final, still layout
- **Light:** CSS animation (or a small inline SVG animation). No animation library and no video. No new package without asking first
- **No layout shift:** nothing jumps or moves the form after it appears. The sign-in button is usable immediately
- **Performance:** animate only properties that are cheap for the browser (such as transform and opacity). The page stays fast on a low-cost Android phone
- Only on the sign-in page (and optionally the password reset and invitation pages for consistency). The workspace stays still

## Not in this feature

- Changing store branding or customer page design (beyond the small "Powered by Fluta")
- Animations inside the workspace
- A marketing website
- Changing sign-in behaviour, security, or rate limits

## Done when

- The logo exists in all four versions as SVG, and the `Logo` component offers them
- The symbol is recognisable at 16 pixels, and the new tab icon and app icons are in place for Fluta's own pages only
- Store booking and tracking pages still show only their store's icons, with the small "Powered by Fluta" and "Privacy" link in the footer, and `/privacy` shows the placeholder until the real notice is added
- Emails from Fluta show the logo PNG with alternative text
- The sign-in page has the polished layout and gentle animation, and no animation runs with reduced motion turned on
- Unit tests: the `Logo` component renders each variant with its accessible name
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, and `npm run build` all pass

## Verify with

- **Playwright MCP:**
  - study the Termii reference first, at desktop and mobile widths
  - check the sign-in page at ~360px and desktop, light and dark, with reduced motion on and off
  - check the logo in the sidebar, mobile menu, invitation page, and browser tab
  - check a store booking page still shows the store's own icon and logo, with "Powered by Fluta" in the footer
- **Next.js DevTools:** no runtime or build errors on the sign-in page and workspace
- Send yourself an invitation or password reset email and check the logo shows

## References

- @context/brand/fluta-logo.jpeg (the chosen logo, all versions)
- @context/features/01-foundation-design-system-spec.md (`Logo` component, tokens)
- @context/features/03-auth-access-spec.md (sign-in page)
- @context/features/13-customer-booking-spec.md (store icons on customer pages)
- @context/coding-standards.md (Styling, Accessibility)
