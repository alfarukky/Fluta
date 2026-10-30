"use client";

import { useRouter } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getRatingLabel, REVIEW_RATINGS } from "@/lib/reviews";
import { toReviewListSearch, type ReviewListFilters } from "@/schemas/reviews";

// Select items can't have an empty value, so "any" stands for no filter.
const ANY = "any";

// The star filter lives in the page address, so back, refresh, and shared
// links keep it. Each change is a new history entry.
export function ReviewFilters({ filters }: { filters: ReviewListFilters }) {
  const router = useRouter();

  return (
    <section aria-label="Filter reviews">
      <Select
        value={filters.rating === null ? ANY : String(filters.rating)}
        onValueChange={(value) => {
          const rating = REVIEW_RATINGS.find((star) => String(star) === value) ?? null;
          router.push(`/reviews${toReviewListSearch({ rating })}`, { scroll: false });
        }}
      >
        <SelectTrigger aria-label="Star rating" className="w-full xs:max-w-60">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={ANY}>All ratings</SelectItem>
          {[...REVIEW_RATINGS].reverse().map((star) => (
            <SelectItem key={star} value={String(star)}>
              {getRatingLabel(star)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
