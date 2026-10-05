import { brandColorSchema } from "@/schemas/stores";

// A swatch and the hex value. The colour is validated as #RRGGBB and drawn as
// an SVG fill attribute, never put into CSS.
export function BrandColorSwatch({ color }: { color: string | null }) {
  const parsed = brandColorSchema.safeParse(color);
  if (!parsed.success) {
    return <p className="type-h3 text-muted-foreground">Not set</p>;
  }

  const hex = parsed.data.toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 40 40" className="size-10 shrink-0 rounded-md border border-border" aria-hidden>
        <rect width="40" height="40" fill={hex} />
      </svg>
      <p className="type-h3 font-mono text-foreground">{hex}</p>
    </div>
  );
}
