import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import {
  BadgesSection,
  ButtonsSection,
  CardsSection,
  FeedbackSection,
  IconsSection,
  InputsSection,
  OverlaysSection,
  TabsSection,
} from "@/components/design-system/ComponentSections";
import {
  CompositionsSection,
  ResponsiveSection,
} from "@/components/design-system/CompositionSections";
import {
  ColorSection,
  RadiusSection,
  SpacingSection,
  TypographySection,
} from "@/components/design-system/FoundationSections";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { isDevelopment } from "@/lib/env";

// Internal page for checking the foundation visually; not linked from the product.
export const metadata: Metadata = {
  title: "Design system · Fluta",
  robots: { index: false, follow: false },
};

const NAV_ITEMS = [
  { href: "#typography", label: "Typography" },
  { href: "#colours", label: "Colours" },
  { href: "#spacing", label: "Spacing" },
  { href: "#surfaces", label: "Surfaces" },
  { href: "#buttons", label: "Buttons" },
  { href: "#inputs", label: "Inputs" },
  { href: "#badges", label: "Badges" },
  { href: "#cards", label: "Cards" },
  { href: "#tabs", label: "Tabs" },
  { href: "#overlays", label: "Overlays" },
  { href: "#feedback", label: "Feedback" },
  { href: "#icons", label: "Icons" },
  { href: "#responsive", label: "Responsive" },
  { href: "#compositions", label: "Compositions" },
];

export default function DesignSystemPage() {
  // Checked here, not in a layout: Next renders layouts and pages in parallel,
  // so a layout-level notFound() still serializes this page into the response.
  if (!isDevelopment()) {
    notFound();
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="page-container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo />
            <Badge variant="neutral">Internal</Badge>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="page-container flex flex-col gap-section py-section">
        <div className="flex flex-col gap-3">
          <p className="type-label text-primary">Feature 01 · Foundation</p>
          <h1 className="type-display">Design system</h1>
          <p className="type-body max-w-2xl text-muted-foreground">
            Tokens, components and sample layouts that every Fluta screen builds
            on. Use the theme button to check light and dark.
          </p>
          <nav aria-label="Sections" className="mt-2">
            <ul className="flex flex-wrap gap-2">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="type-caption inline-flex h-9 items-center rounded-full border border-border bg-card px-3 font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <TypographySection />
        <ColorSection />
        <SpacingSection />
        <RadiusSection />
        <ButtonsSection />
        <InputsSection />
        <BadgesSection />
        <CardsSection />
        <TabsSection />
        <OverlaysSection />
        <FeedbackSection />
        <IconsSection />
        <ResponsiveSection />
        <CompositionsSection />
      </main>
    </>
  );
}
