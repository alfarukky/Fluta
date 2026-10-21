# Feature 01 — Foundation & Design System

## Overview

First feature of Fluta. Establishes the visual and UI foundation that every later feature relies on.

The goal is a clean, minimalistic, mobile-first design system inspired by the supplied reference screenshots. The screenshots are visual references, not strict pixel-perfect specifications.

The design direction should be calm, spacious, professional, and consistent, using a forest-green Fluta primary colour, soft neutral surfaces, rounded components, subtle borders, and minimal shadows.

Feature 01 also includes an internal design-system showcase with realistic static placeholder data. This allows the visual experience to be validated before real product functionality is implemented.

Store-specific branding is supported architecturally through theme tokens but is not implemented in this feature. Store branding belongs to Feature 05 and is primarily used for the customer-facing experience.

## Requirements

### Project and UI foundation

- Use the existing Next.js App Router project.
- Confirm TypeScript strict mode is enabled.
- Configure Tailwind CSS v4 in `src/app/globals.css` using `@theme`.
- Do not create a `tailwind.config.*` file.
- Use semantic CSS/design tokens rather than hard-coded colours throughout reusable components.

### Theme system

Support both light and dark themes.

- Light theme is the default.
- Dark theme must use the same semantic design tokens.
- Theme switching should not require individual product components to define their own colours.

Define semantic tokens for:

- `background`
- `foreground`
- `card`
- `card-foreground`
- `muted`
- `muted-foreground`
- `border`
- `primary`
- `primary-foreground`
- `accent`
- `accent-foreground`
- `success`
- `warning`
- `error`
- `info`

The initial Fluta primary colour should be the forest-green colour selected from the reference screenshots:

- `#173C32`

The colour must be defined through the theme/token system so it can be changed centrally later.

### Typography

- Use Inter.
- Load Inter using `next/font`.
- Establish reusable typography styles for:
  - display
  - headings
  - body
  - small body
  - labels
  - captions
- Typography must remain readable on mobile.

### Spacing and layout

Establish a consistent spacing and layout system for:

- page padding
- section spacing
- card padding
- form spacing
- grid gaps
- component gaps

The application must be mobile-first.

The foundation must support:

- small mobile
- large mobile
- tablet
- desktop

Do not design desktop first and retrofit mobile afterwards.

### Radius and surfaces

Define semantic radius tokens:

- `radius-sm`
- `radius-md`
- `radius-lg`
- `radius-xl`
- `radius-full`

Use the reference screenshots as the guide for the rounded visual style.

Use subtle borders as the primary method of separating surfaces.

Use minimal shadows only where useful, such as:

- dropdowns
- dialogs
- sheets
- floating/elevated elements

Avoid heavy shadows as a general UI pattern.

### UI components

Initialize shadcn/ui for Tailwind v4.

Add only components required by the current roadmap:

- button
- input
- label
- card
- badge
- avatar
- dropdown-menu
- sheet
- separator
- table
- tabs
- dialog
- skeleton
- sonner

Do not turn Feature 01 into a large general-purpose component library.

### Component variants

Establish reusable semantic variants.

Buttons:

- primary
- secondary
- outline
- ghost
- destructive

Badges:

- neutral
- success
- warning
- error
- info

Components should consume semantic tokens rather than hard-coded colours.

### Icons

Install Lucide Icons.

Lucide is the standard icon library for Fluta.

Do not introduce multiple icon libraries.

### Fluta logo

Create a reusable Fluta `Logo` component.

For Feature 01:

- use a simple text placeholder such as `fluta`
- no final logo asset is required
- no store logo functionality is required

The component should allow the final logo asset to replace the placeholder later without changing components that consume it.

### Responsive and accessibility foundation

All reusable components must work on both mobile and desktop.

Accessibility is part of the foundation.

Components should provide, where applicable:

- semantic HTML
- accessible labels
- keyboard navigation
- visible focus states
- focus management for dialogs/sheets
- sufficient colour contrast
- disabled states
- appropriate ARIA attributes

### Design-system showcase

Create an internal development route:

`/design-system`

This is not a customer-facing product page.

It exists to visually validate the foundation.

The showcase should demonstrate:

- typography
- colour tokens
- buttons and variants
- inputs and states
- cards
- badges
- tables
- tabs
- dialogs
- sheets
- skeleton/loading states
- toast notifications
- empty states
- icons
- responsive behaviour
- light and dark themes

### Static product compositions

The design-system showcase should also contain realistic static compositions using placeholder data.

These compositions are used to validate how the foundation works when components are combined.

Use realistic examples such as:

- a mock store/workspace preview
- order/status cards
- summary cards
- tables
- mobile layouts

All data must be static placeholder data.

These compositions must not contain real application functionality.

They must not require:

- authentication
- database access
- API calls
- real store data
- real users
- real orders

The purpose is visual and UX validation only.

## Not in this feature

- Database
- Prisma
- Authentication
- Better Auth
- Store creation
- Owner accounts
- Staff accounts
- Store workspace functionality
- Owner dashboard
- Store settings
- Store branding configuration
- Service catalogue
- Orders
- Customers
- Customer booking
- Payments
- Notifications
- Business/domain logic
- Business-specific helper utilities such as money, phone, or time helpers

Store branding overrides are a later feature, specifically Feature 05.

The actual Workspace Shell is Feature 04.

The Owner Dashboard is Feature 20.

## Done when

- Light theme works.
- Dark theme works.
- Light theme is the default.
- Fluta primary colour is established through semantic tokens.
- Typography is established using Inter.
- Spacing and responsive layout rules are established.
- Radius, border, and elevation conventions are established.
- Tailwind CSS v4 is configured correctly.
- shadcn/ui is configured correctly.
- Required UI components are available.
- Component variants are established.
- Lucide Icons are installed and established as the standard icon system.
- Fluta logo placeholder component exists.
- `/design-system` exists.
- The design-system showcase demonstrates the foundation components.
- Static placeholder compositions demonstrate how the components work together.
- Mobile and desktop layouts are visually usable.
- Light and dark themes can be visually inspected.
- Accessibility fundamentals are implemented.
- No real product functionality has been introduced.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.

## References

@context/project-overview.md
@context/screenshots/customer-desktop-reference.png
@context/screenshots/customer-mobile-reference.png
