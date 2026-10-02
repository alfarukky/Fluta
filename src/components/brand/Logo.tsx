import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-3xl",
};

// Text placeholder until the final Fluta asset exists; swap the markup here
// and every consumer picks it up.
export function Logo({ size = "md", className }: LogoProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center leading-none font-bold tracking-tight text-primary",
        SIZE_CLASSES[size],
        className,
      )}
    >
      fluta
    </span>
  );
}
