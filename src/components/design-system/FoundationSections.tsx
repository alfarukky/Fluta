import { ShowcaseGroup, ShowcaseSection } from "./ShowcaseSection";

interface TypeSample {
  name: string;
  className: string;
  spec: string;
  sample: string;
}

// Full class strings so Tailwind can see every utility at build time.
const TYPE_SCALE: TypeSample[] = [
  { name: "Display", className: "type-display", spec: "32 / 40 → 40 / 48 · Bold", sample: "Your laundry, made simple" },
  { name: "Heading 1", className: "type-h1", spec: "24 / 32 → 30 / 38 · Semibold", sample: "Good morning, Amaka" },
  { name: "Heading 2", className: "type-h2", spec: "20 / 28 · Semibold", sample: "Attention required" },
  { name: "Heading 3", className: "type-h3", spec: "16 / 24 · Semibold", sample: "Active order" },
  { name: "Body", className: "type-body", spec: "16 / 24 · Regular", sample: "Track your current order, book a service, and keep your wardrobe moving." },
  { name: "Small body", className: "type-body-sm", spec: "14 / 20 · Regular", sample: "Here's the latest on your laundry." },
  { name: "Label", className: "type-label", spec: "14 / 20 · Medium", sample: "Phone number" },
  { name: "Caption", className: "type-caption", spec: "12 / 16 · Regular", sample: "Placed today at 9:42 AM" },
];

interface ColorToken {
  name: string;
  swatch: string;
  text?: string;
}

const SURFACE_TOKENS: ColorToken[] = [
  { name: "background", swatch: "bg-background", text: "text-foreground" },
  { name: "foreground", swatch: "bg-foreground", text: "text-background" },
  { name: "card", swatch: "bg-card", text: "text-card-foreground" },
  { name: "card-foreground", swatch: "bg-card-foreground", text: "text-card" },
  { name: "muted", swatch: "bg-muted", text: "text-muted-foreground" },
  { name: "muted-foreground", swatch: "bg-muted-foreground", text: "text-muted" },
  { name: "border", swatch: "bg-border", text: "text-foreground" },
];

const BRAND_TOKENS: ColorToken[] = [
  { name: "primary", swatch: "bg-primary", text: "text-primary-foreground" },
  { name: "primary-foreground", swatch: "bg-primary-foreground", text: "text-primary" },
  { name: "accent", swatch: "bg-accent", text: "text-accent-foreground" },
  { name: "accent-foreground", swatch: "bg-accent-foreground", text: "text-accent" },
];

const STATUS_TOKENS: ColorToken[] = [
  { name: "success", swatch: "bg-success" },
  { name: "warning", swatch: "bg-warning" },
  { name: "error", swatch: "bg-error" },
  { name: "info", swatch: "bg-info" },
];

interface SpacingToken {
  name: string;
  utility: string;
  bar: string;
  values: string;
}

const SPACING_TOKENS: SpacingToken[] = [
  { name: "Page padding", utility: "px-page", bar: "w-page", values: "16 → 24 → 32px" },
  { name: "Section spacing", utility: "py-section · gap-section", bar: "w-section", values: "32 → 40 → 48px" },
  { name: "Card padding", utility: "p-card", bar: "w-card", values: "16 → 20px" },
  { name: "Form spacing", utility: "gap-form", bar: "w-form", values: "16px" },
  { name: "Grid gap", utility: "gap-grid", bar: "w-grid", values: "16 → 20 → 24px" },
  { name: "Component gap", utility: "gap-component", bar: "w-component", values: "8px" },
];

interface RadiusToken {
  name: string;
  className: string;
  use: string;
}

const RADIUS_TOKENS: RadiusToken[] = [
  { name: "radius-sm", className: "rounded-sm", use: "Checkboxes, small chips" },
  { name: "radius-md", className: "rounded-md", use: "Small buttons, menu items" },
  { name: "radius-lg", className: "rounded-lg", use: "Buttons, inputs, menus" },
  { name: "radius-xl", className: "rounded-xl", use: "Cards, dialogs" },
  { name: "radius-full", className: "rounded-full", use: "Badges, avatars, pills" },
];

interface ColorSwatchProps {
  token: ColorToken;
}

interface SwatchGridProps {
  tokens: ColorToken[];
}

function ColorSwatch({ token }: ColorSwatchProps) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex h-16 items-end rounded-lg border border-border p-2 ${token.swatch}`}
      >
        {token.text && (
          <span className={`type-caption font-medium ${token.text}`}>Aa</span>
        )}
      </div>
      <code className="type-caption font-mono text-muted-foreground">
        {token.name}
      </code>
    </div>
  );
}

function SwatchGrid({ tokens }: SwatchGridProps) {
  return (
    <div className="grid grid-cols-2 gap-grid xs:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
      {tokens.map((token) => (
        <ColorSwatch key={token.name} token={token} />
      ))}
    </div>
  );
}

export function TypographySection() {
  return (
    <ShowcaseSection
      id="typography"
      title="Typography"
      description="Inter, loaded with next/font. Each type-* utility sets size, line height, weight and tracking together. Display and Heading 1 step up from tablet."
    >
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {TYPE_SCALE.map((item) => (
          <div
            key={item.name}
            className="flex flex-col gap-2 p-card md:flex-row md:items-baseline md:gap-6"
          >
            <div className="flex shrink-0 flex-col md:w-64">
              <span className="type-label">{item.name}</span>
              <code className="type-caption font-mono text-muted-foreground">
                .{item.className} · {item.spec}
              </code>
            </div>
            <p className={item.className}>{item.sample}</p>
          </div>
        ))}
      </div>
    </ShowcaseSection>
  );
}

export function ColorSection() {
  return (
    <ShowcaseSection
      id="colours"
      title="Colour tokens"
      description="Semantic tokens defined once in globals.css. The dark theme redefines the same names, and components never use raw colours."
    >
      <div className="flex flex-col gap-8">
        <ShowcaseGroup title="Surfaces and text">
          <SwatchGrid tokens={SURFACE_TOKENS} />
        </ShowcaseGroup>
        <ShowcaseGroup title="Brand (primary: Fluta forest green #173C32)">
          <SwatchGrid tokens={BRAND_TOKENS} />
        </ShowcaseGroup>
        <ShowcaseGroup title="Status">
          <SwatchGrid tokens={STATUS_TOKENS} />
        </ShowcaseGroup>
      </div>
    </ShowcaseSection>
  );
}

export function SpacingSection() {
  return (
    <ShowcaseSection
      id="spacing"
      title="Spacing and layout"
      description="Mobile-first spacing tokens that grow at tablet (md, 768px) and desktop (lg, 1024px). Resize the window to see the bars change. Pages use the page-container utility for width and gutter."
    >
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {SPACING_TOKENS.map((token) => (
          <div
            key={token.name}
            className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 p-card md:grid-cols-[12rem_1fr_10rem]"
          >
            <div className="flex flex-col">
              <span className="type-label">{token.name}</span>
              <code className="type-caption font-mono text-muted-foreground">
                {token.utility}
              </code>
            </div>
            <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
              <div className={`h-3 rounded-sm bg-primary ${token.bar}`} />
            </div>
            <span className="type-caption text-right text-muted-foreground md:text-left">
              {token.values}
            </span>
          </div>
        ))}
      </div>
    </ShowcaseSection>
  );
}

export function RadiusSection() {
  return (
    <ShowcaseSection
      id="surfaces"
      title="Radius, borders and elevation"
      description="Rounded but restrained. Subtle borders separate surfaces; soft shadows are reserved for layers that float above the page."
    >
      <div className="flex flex-col gap-8">
        <ShowcaseGroup title="Radius">
          <div className="grid grid-cols-2 gap-grid xs:grid-cols-3 md:grid-cols-5">
            {RADIUS_TOKENS.map((token) => (
              <div key={token.name} className="flex flex-col gap-2">
                <div
                  className={`h-16 border border-border bg-accent ${token.className}`}
                />
                <code className="type-caption font-mono">{token.name}</code>
                <span className="type-caption text-muted-foreground">
                  {token.use}
                </span>
              </div>
            ))}
          </div>
        </ShowcaseGroup>
        <ShowcaseGroup title="Surfaces">
          <div className="grid gap-grid md:grid-cols-3">
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-card">
              <span className="type-label">Card</span>
              <span className="type-caption text-muted-foreground">
                bg-card · border · no shadow
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-xl bg-muted p-card">
              <span className="type-label">Muted panel</span>
              <span className="type-caption text-muted-foreground">
                bg-muted · nested inside cards
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-popover p-card shadow-lg">
              <span className="type-label">Elevated</span>
              <span className="type-caption text-muted-foreground">
                shadow-lg · dropdowns, dialogs, sheets
              </span>
            </div>
          </div>
        </ShowcaseGroup>
      </div>
    </ShowcaseSection>
  );
}
