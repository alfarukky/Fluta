import { FOLD_PATHS, SYMBOL_SIZE } from "@/components/brand/logo-art";
import { cn } from "@/lib/utils";

// The logo's three leaf-like folds, large and faint, drifting slowly behind
// the sign-in brand panel. Decorative only. They move with transform alone
// (globals.css), and not at all with reduced motion.
const FOLDS = [
  {
    d: FOLD_PATHS[0],
    opacity: "opacity-[0.06]",
    position: "-right-[30%] -top-[12%] w-[110%]",
    animation: "motion-safe:animate-fold-drift-a",
  },
  {
    d: FOLD_PATHS[1],
    opacity: "opacity-[0.045]",
    position: "-left-[35%] top-[30%] w-[95%]",
    animation: "motion-safe:animate-fold-drift-b",
  },
  {
    d: FOLD_PATHS[2],
    opacity: "opacity-[0.05]",
    position: "-right-[10%] -bottom-[18%] w-[80%]",
    animation: "motion-safe:animate-fold-drift-c",
  },
] as const;

export function FoldBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {FOLDS.map((fold) => (
        <svg
          key={fold.d}
          viewBox={`0 0 ${SYMBOL_SIZE} ${SYMBOL_SIZE}`}
          className={cn("absolute h-auto will-change-transform", fold.position, fold.opacity, fold.animation)}
        >
          <path d={fold.d} fill="currentColor" />
        </svg>
      ))}
    </div>
  );
}
