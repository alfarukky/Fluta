"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { loadMoreReviews } from "@/actions/reviews";
import { Button } from "@/components/ui/button";
import { getOrderPath } from "@/lib/order-links";
import { describeRating } from "@/lib/reviews";
import type { ReviewListFilters } from "@/schemas/reviews";
import type { ReviewListRow } from "@/types/reviews";

import { RatingStars } from "./RatingStars";

interface ReviewListProps {
  filters: ReviewListFilters;
  initialRows: ReviewListRow[];
  initialCursor: string | null;
}

// The store's reviews, newest first, 25 at a time. More load when "Load more"
// scrolls into view, or when it is tapped. Comments are plain text, shown as
// typed (React escapes them).
export function ReviewList({ filters, initialRows, initialCursor }: ReviewListProps) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  function loadMore() {
    if (!cursor || pending) return;
    startTransition(async () => {
      const result = await loadMoreReviews(filters, cursor);
      if (!result.ok) {
        setFailed(true);
        toast.error(result.message);
        return;
      }
      setFailed(false);
      setRows((current) => [...current, ...result.rows]);
      setCursor(result.nextCursor);
    });
  }

  // Load the next page as the button comes into view, unless the last try
  // failed (then the button waits for a tap, so errors don't repeat).
  const loadMoreOnView = useEffectEvent(loadMore);
  useEffect(() => {
    const button = loadMoreRef.current;
    if (!button || failed || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreOnView();
    });
    observer.observe(button);
    return () => observer.disconnect();
  }, [cursor, failed]);

  return (
    <section aria-label="Reviews" className="flex flex-col gap-component">
      <ul className="flex flex-col gap-component">
        {rows.map((row) => (
          <ReviewItem key={row.id} row={row} />
        ))}
      </ul>

      {cursor && (
        <Button ref={loadMoreRef} variant="outline" onClick={loadMore} disabled={pending} className="self-center">
          {pending ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}

function ReviewItem({ row }: { row: ReviewListRow }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-card">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <RatingStars rating={row.rating} label={describeRating(row.rating)} />
        <span className="type-caption text-muted-foreground">{row.date}</span>
      </div>
      {row.comment ? (
        <p className="type-body-sm wrap-break-word whitespace-pre-line text-foreground">{row.comment}</p>
      ) : (
        <p className="type-body-sm text-muted-foreground">No comment.</p>
      )}
      <p className="type-body-sm flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground">
        <span className="wrap-break-word text-foreground">{row.customerName}</span>
        <span aria-hidden>·</span>
        <Link
          href={getOrderPath(row.orderId)}
          className="type-label text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
        >
          Order {row.displayNumber}
        </Link>
      </p>
    </li>
  );
}
