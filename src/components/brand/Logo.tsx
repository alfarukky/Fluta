import { useId } from "react";

import { cn } from "@/lib/utils";

import {
  FOLD_PATHS,
  FULL_WIDTH,
  SYMBOL_RADIUS,
  SYMBOL_SIZE,
  WORDMARK_OFFSET,
  WORDMARK_PATHS,
  WORDMARK_STROKE,
} from "./logo-art";

type LogoVariant = "full" | "symbol";
// default: forest green folds on mint. reversed: for dark surfaces, a white
// square with the green folds and a white wordmark. mono: one colour (the
// text colour), with the folds cut out, for quiet places like "Powered by
// Fluta".
type LogoTone = "default" | "reversed" | "mono";
type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";

interface LogoProps {
  variant?: LogoVariant;
  tone?: LogoTone;
  size?: LogoSize;
  // Hidden from assistive technology when text beside it already says Fluta.
  decorative?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<LogoSize, string> = {
  xs: "h-4",
  sm: "h-6",
  md: "h-8",
  lg: "h-10",
  xl: "h-14",
};

// Theme tokens, so the logo follows light and dark automatically.
const TONE_CLASSES: Record<Exclude<LogoTone, "mono">, { square: string; folds: string; wordmark: string }> = {
  default: { square: "fill-accent", folds: "fill-primary", wordmark: "stroke-primary" },
  reversed: { square: "fill-primary-foreground", folds: "fill-primary", wordmark: "stroke-primary-foreground" },
};

export function Logo({ variant = "full", tone = "default", size = "md", decorative = false, className }: LogoProps) {
  const maskId = useId();
  const width = variant === "full" ? FULL_WIDTH : SYMBOL_SIZE;
  const colours = tone === "mono" ? null : TONE_CLASSES[tone];

  return (
    <svg
      viewBox={`0 0 ${width} ${SYMBOL_SIZE}`}
      className={cn("w-auto shrink-0", SIZE_CLASSES[size], className)}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "Fluta" })}
    >
      {colours ? (
        <>
          <rect width={SYMBOL_SIZE} height={SYMBOL_SIZE} rx={SYMBOL_RADIUS} className={colours.square} />
          {FOLD_PATHS.map((d) => (
            <path key={d} d={d} className={colours.folds} />
          ))}
        </>
      ) : (
        <>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={SYMBOL_SIZE} height={SYMBOL_SIZE}>
            <rect width={SYMBOL_SIZE} height={SYMBOL_SIZE} rx={SYMBOL_RADIUS} fill="#fff" />
            {FOLD_PATHS.map((d) => (
              <path key={d} d={d} fill="#000" />
            ))}
          </mask>
          <rect width={SYMBOL_SIZE} height={SYMBOL_SIZE} rx={SYMBOL_RADIUS} fill="currentColor" mask={`url(#${maskId})`} />
        </>
      )}
      {variant === "full" && (
        <g
          transform={`translate(${WORDMARK_OFFSET.x} ${WORDMARK_OFFSET.y})`}
          className={colours?.wordmark}
          stroke={colours ? undefined : "currentColor"}
          strokeWidth={WORDMARK_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {WORDMARK_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      )}
    </svg>
  );
}
