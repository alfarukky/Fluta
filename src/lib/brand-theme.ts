import { brandColorSchema } from "@/schemas/stores";

// Store branding on customer pages (Feature 13) and in the settings preview.
// getBrandTheme() is the only place store colours become CSS: each colour is
// re-checked as #RRGGBB and only ever used as a CSS variable value. globals.css
// maps the --brand-* variables onto the primary and accent tokens of the
// element carrying the data-brand-* attributes, for light and dark.

export type Hex = `#${string}`;

// Text on brand-coloured fills. One of the two always reaches WCAG AA (4.5:1)
// against any colour.
const LIGHT_TEXT = "#FFFFFF";
const DARK_TEXT = "#000000";

export const AA_CONTRAST = 4.5;

// The surfaces primary is used on as text, links and borders (background,
// card, popover in globals.css). Keep in sync with :root and .dark there.
const LIGHT_SURFACES = ["#F6F8F7", "#FFFFFF"];
const DARK_SURFACES = ["#0D1412", "#141D1A", "#18221F"];

export interface BrandColors {
  primary: string | null | undefined;
  accent: string | null | undefined;
}

export interface BrandThemeProps {
  style: Record<`--brand-${string}`, string>;
  "data-brand-primary"?: "";
  "data-brand-accent"?: "";
}

// Spread onto the branded root: <div {...getBrandTheme(colors)}>. A missing or
// invalid colour leaves Fluta's own token in place.
export function getBrandTheme(colors: BrandColors): BrandThemeProps {
  const theme: BrandThemeProps = { style: {} };

  const primary = parseHex(colors.primary);
  if (primary) {
    // Primary is also used as text on the page, so each theme gets a shade
    // that stays readable on that theme's surfaces.
    const light = ensureContrast(primary, LIGHT_SURFACES, DARK_TEXT);
    const dark = ensureContrast(primary, DARK_SURFACES, LIGHT_TEXT);
    theme.style["--brand-primary"] = light;
    theme.style["--brand-primary-foreground"] = readableTextOn(light);
    theme.style["--brand-primary-dark"] = dark;
    theme.style["--brand-primary-dark-foreground"] = readableTextOn(dark);
    theme["data-brand-primary"] = "";
  }

  const accent = parseHex(colors.accent);
  if (accent) {
    // Accent is a fill with its own text colour, so it reads in both themes.
    theme.style["--brand-accent"] = accent;
    theme.style["--brand-accent-foreground"] = readableTextOn(accent);
    theme["data-brand-accent"] = "";
  }

  return theme;
}

// White or black text, whichever contrasts more with the fill (always ≥ 4.5:1).
export function readableTextOn(fill: Hex): Hex {
  return contrastRatio(fill, LIGHT_TEXT) >= contrastRatio(fill, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

// The colour itself if it reaches AA on every surface; otherwise the first
// step towards `toward` (black for light themes, white for dark) that does.
export function ensureContrast(color: Hex, surfaces: readonly string[], toward: Hex): Hex {
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, toward, step / 20);
    if (surfaces.every((surface) => contrastRatio(candidate, surface) >= AA_CONTRAST)) return candidate;
  }
  return toward;
}

// WCAG 2 contrast ratio between two #RRGGBB colours (1 to 21).
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseHex(value: string | null | undefined): Hex | null {
  const parsed = brandColorSchema.safeParse(value);
  return parsed.success ? (parsed.data.toUpperCase() as Hex) : null;
}

function toRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function mix(from: Hex, to: Hex, amount: number): Hex {
  const a = toRgb(from);
  const b = toRgb(to);
  const channels = a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount));
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
