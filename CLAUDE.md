# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev`: dev server at http://localhost:3000 (Turbopack)
- `npm run build`: production build; also runs the TypeScript check
- `npm run lint`: ESLint over the whole repo (flat config in `eslint.config.mjs`); lint one file with `npx eslint <path>`
- `npm run typecheck`: type-check without building (`tsc --noEmit`)
- `npm test`: run the Vitest suite once; `npm run test:watch` for watch mode; run one file with `npx vitest run <path>`

Tests use Vitest + React Testing Library in jsdom (`vitest.config.mts`). Test files are colocated as `src/**/*.test.{ts,tsx}`, and `@/*` imports resolve through `resolve.tsconfigPaths`. Vitest can't render `async` Server Components, so test those end-to-end instead.

## Stack and architecture

- **Next.js 16 (App Router) + React 19 + TypeScript (strict).** Routes live in `src/app/`. There is no `pages/` directory. Next.js 16 differs from older versions, so check `node_modules/next/dist/docs/` (`01-app/` covers the App Router) before using framework APIs.
- **Route type helpers:** layouts and pages use Next's globally generated types, such as `LayoutProps<"/">` in `src/app/layout.tsx`. They are generated into `.next/types` / `.next/dev/types` (both included in `tsconfig.json`), so run `dev` or `build` once if they appear missing.
- **Import alias:** `@/*` maps to `src/*`.
- **Styling:** Tailwind CSS v4 through `@tailwindcss/postcss`. There is no `tailwind.config.*`. All design tokens live in `src/app/globals.css`:
  - Semantic colours (`background`, `card`, `muted`, `primary`, `accent`, `success`, `warning`, `error`, `info`, …) are CSS variables on `:root`, redefined under `.dark`, and exposed via `@theme inline`. Components use only these (`bg-primary`, `text-muted-foreground`), never raw colours or `dark:` overrides.
  - Typography uses `type-*` utilities (`type-display`, `type-h1`–`type-h3`, `type-body`, `type-body-sm`, `type-label`, `type-caption`). They are named `type-*`, not `text-*`, so `cn()` class merging doesn't drop them in favour of text colours.
  - Responsive spacing tokens: `px-page`, `py-section`, `p-card`, `gap-form`, `gap-grid`, `gap-component`, plus the `page-container` utility. Breakpoints are mobile-first: base (small mobile), `xs` 400px, `md` 768px (tablet), `lg` 1024px (desktop).
  - Radius `rounded-sm|md|lg|xl|full`; surfaces are separated by borders, and shadows are only for elevated layers.
- **Theme:** `next-themes` (`src/components/theme/`) toggles the `.dark` class on `<html>`. Light is the default and the system preference is ignored.
- **UI components:** shadcn/ui (Radix base, `components.json`) in `src/components/ui/`, add more with `npx shadcn@latest add <name>`. Variants are customised: Button `primary|secondary|outline|ghost|destructive|link` (44px default height), Badge `neutral|success|warning|error|info` (optional decorative `dot`). Icons come only from `lucide-react`. Toasts use `sonner` (`<Toaster />` is in the root layout).
- **Internal showcase:** `/design-system` (`src/app/design-system/`, sections in `src/components/design-system/`) demonstrates every token and component using static FreshFold Laundry sample data. Check new UI there in both themes at ~360px and desktop widths.
  - **Development-only:** the page calls `notFound()` unless `isDevelopment()` (`src/lib/env.ts`, the only module that reads `process.env`) is true, so production serves a 404. Keep the guard in the page itself, not a layout: Next renders layouts and pages in parallel, so a layout-level `notFound()` still serializes the page into the 404 response. Showcase client components take their sample text as props from the server page so none of it ends up in client bundles.
- **Home page:** `src/app/page.tsx` is a placeholder (logo, tagline, and a development-only link to `/design-system`). No product screens yet.
- Static assets go in `public/`.
