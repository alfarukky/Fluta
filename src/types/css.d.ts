import "react";

// Lets `style` carry CSS custom properties, which is how validated store brand
// colours reach the page (see getBrandTheme in src/lib/brand-theme.ts).
declare module "react" {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
