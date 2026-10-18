// The Fluta logo's geometry, shared by the Logo component and the generated
// files in public/ (scripts/generate-brand-assets.ts), so they never drift.
//
// The symbol is a capital "F" made of three soft, leaf-like folds stacked on
// a shared left edge, inside a rounded square: a long top fold sweeping up to
// the right, a shorter middle fold, and a small bottom fold. The wordmark is
// "fluta" drawn as rounded strokes on the same 64-unit height. Based on
// context/brand/fluta-logo.jpeg, drawn flat (no gradients) so it stays clear
// at 16 pixels.

export const SYMBOL_SIZE = 64;
export const SYMBOL_RADIUS = 16;

export const FOLD_PATHS = [
  "M13 34V26C13 16.5 26 8.5 54 5.5C51.5 13 46 19 38 22C29 25 18 26 13 34Z",
  "M13 46.5V37C14.5 30.5 24 27.2 36 26.3L47.5 25.3C49.5 25.1 50.3 26.3 49.6 28C48.3 31 45.5 33 40.5 34.2C30.5 36.6 18.5 37.8 13 46.5Z",
  "M13 59.5V49C15 42.5 21 39.6 29.5 38.6C29.5 46.5 25 54.5 13 59.5Z",
] as const;

export const WORDMARK_STROKE = 7;
export const WORDMARK_PATHS = [
  "M8 48V21c0-5 3-8 8-8h3M2.5 28.5H16",
  "M28 13v29c0 4 2 6 5 6",
  "M40 28v11c0 5.5 3.5 9 8.5 9s8.5-3.5 8.5-9V28m0 0v20",
  "M68 17v25c0 4 2 6 5 6M62.5 28.5H75",
  "M102 28v20M92 28a10 10 0 1 0 0 20a10 10 0 1 0 0-20",
] as const;
// Where the wordmark sits beside the symbol in the full lockup.
export const WORDMARK_OFFSET = { x: 78, y: 1 } as const;
export const FULL_WIDTH = 186;

export interface LogoColours {
  square: string;
  folds: string;
  wordmark: string;
}

// The coloured versions for files outside the page (icons, emails). In the
// page, the Logo component uses theme tokens instead.
export const BRAND_COLOURS = {
  default: { square: "#e4f1ea", folds: "#173c32", wordmark: "#173c32" },
  // For dark backgrounds: a white square with the green folds, and a white
  // wordmark.
  reversed: { square: "#ffffff", folds: "#173c32", wordmark: "#ffffff" },
} as const satisfies Record<string, LogoColours>;

// A standalone SVG file of the logo. "mono" is the single-colour version:
// one colour, with the folds cut out of the square.
export function renderLogoSvg(options: {
  variant: "full" | "symbol";
  colours: LogoColours | { mono: string };
}): string {
  const { variant, colours } = options;
  const width = variant === "full" ? FULL_WIDTH : SYMBOL_SIZE;
  const square = (fill: string, extra = "") =>
    `<rect width="${SYMBOL_SIZE}" height="${SYMBOL_SIZE}" rx="${SYMBOL_RADIUS}" fill="${fill}"${extra}/>`;
  const folds = (fill: string) => FOLD_PATHS.map((d) => `<path d="${d}" fill="${fill}"/>`).join("");

  let symbol: string;
  let wordmarkColour: string;
  if ("mono" in colours) {
    wordmarkColour = colours.mono;
    symbol =
      `<mask id="fluta-folds" maskUnits="userSpaceOnUse" x="0" y="0" width="${SYMBOL_SIZE}" height="${SYMBOL_SIZE}">` +
      `${square("#fff")}${folds("#000")}</mask>` +
      square(colours.mono, ' mask="url(#fluta-folds)"');
  } else {
    wordmarkColour = colours.wordmark;
    symbol = square(colours.square) + folds(colours.folds);
  }

  const wordmark =
    variant === "full"
      ? `<g transform="translate(${WORDMARK_OFFSET.x} ${WORDMARK_OFFSET.y})" fill="none" stroke="${wordmarkColour}" stroke-width="${WORDMARK_STROKE}" stroke-linecap="round" stroke-linejoin="round">${WORDMARK_PATHS.map(
          (d) => `<path d="${d}"/>`,
        ).join("")}</g>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${SYMBOL_SIZE}" width="${width}" height="${SYMBOL_SIZE}" role="img" aria-label="Fluta"><title>Fluta</title>${symbol}${wordmark}</svg>\n`;
}
