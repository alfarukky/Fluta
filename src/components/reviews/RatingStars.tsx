import { StarIcon } from "lucide-react";

import { getStarFillTenths, REVIEW_RATINGS } from "@/lib/reviews";
import { cn } from "@/lib/utils";

interface RatingStarsProps {
  rating: number;
  // The rating in words for screen readers ("You rated 4 out of 5"). Leave
  // it out when the rating is already written next to the stars.
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

// The filled part of a star, by tenths (written out so Tailwind generates them).
const FILL_WIDTHS = [
  "w-0",
  "w-[10%]",
  "w-[20%]",
  "w-[30%]",
  "w-[40%]",
  "w-[50%]",
  "w-[60%]",
  "w-[70%]",
  "w-[80%]",
  "w-[90%]",
  "w-full",
] as const;

// Five read-only stars, filled to the exact rating: an average of 4.7 fills
// four stars and 70% of the fifth. A single review always fills whole stars.
export function RatingStars({ rating, label, size = "md", className }: RatingStarsProps) {
  const iconSize = size === "sm" ? "size-4" : "size-5";
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {REVIEW_RATINGS.map((star) => {
        const tenths = getStarFillTenths(rating, star);
        return (
          <span key={star} className="relative inline-flex">
            <StarIcon aria-hidden className={cn(iconSize, "text-muted-foreground")} />
            {tenths > 0 && (
              <span className={cn("absolute inset-y-0 left-0 overflow-hidden", FILL_WIDTHS[tenths])}>
                <StarIcon aria-hidden className={cn(iconSize, "max-w-none shrink-0 fill-warning text-warning")} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
