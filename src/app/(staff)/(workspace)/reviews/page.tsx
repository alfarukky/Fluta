import { SearchXIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { RatingStars } from "@/components/reviews/RatingStars";
import { ReviewFilters } from "@/components/reviews/ReviewFilters";
import { ReviewList } from "@/components/reviews/ReviewList";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getNavItem } from "@/components/workspace/nav-items";
import { PageHeader } from "@/components/workspace/PageHeader";
import { getRatingLabel } from "@/lib/reviews";
import { reviewListFiltersSchema, toReviewListSearch } from "@/schemas/reviews";
import { requireStoreMember } from "@/server/auth/session";
import { getReviewsPageData } from "@/server/services/reviews";
import type { ReviewSummary } from "@/types/reviews";

export const metadata: Metadata = { title: "Reviews · Fluta" };

// Owners and staff, from the Reviews menu item (riders are refused): what
// customers said about the store, private to it. Nothing here is public.
export default async function ReviewsPage({ searchParams }: PageProps<"/reviews">) {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  // Invalid or unknown values show every review.
  const filters = reviewListFiltersSchema.parse(await searchParams);
  const search = toReviewListSearch(filters);
  const { page, recent, allTime } = await getReviewsPageData(member.store, filters, new Date());

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader title="Reviews" description="What customers said after their orders were completed. Only your store sees these." />

      <section aria-label="Average rating" className="grid grid-cols-1 gap-grid xs:grid-cols-2">
        <SummaryCard label="Last 30 days" summary={recent} />
        <SummaryCard label="All time" summary={allTime} />
      </section>

      {/* Keyed by the address, so the loaded rows reset when it changes. */}
      <ReviewFilters key={`filters${search}`} filters={filters} />

      {page.rows.length === 0 ? (
        filters.rating !== null ? (
          <EmptyState
            icon={SearchXIcon}
            title={`No ${getRatingLabel(filters.rating)} reviews`}
            description="Try another rating, or show all reviews."
            action={
              <Button asChild variant="outline">
                <Link href="/reviews">Show all reviews</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={getNavItem("/reviews").icon}
            title="No reviews yet"
            description="Customers can rate an order from its link for 7 days after it is completed. Their reviews show here."
          />
        )
      ) : (
        <ReviewList key={`list${search}`} filters={filters} initialRows={page.rows} initialCursor={page.nextCursor} />
      )}
    </main>
  );
}

function SummaryCard({ label, summary }: { label: string; summary: ReviewSummary }) {
  const average = summary.average;
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <h2 className="type-label text-muted-foreground">{label}</h2>
        {average === null ? (
          <p className="type-body-sm text-muted-foreground">No reviews</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="type-h2 text-foreground">
                {average}
                <span className="sr-only"> out of 5</span>
              </span>
              <RatingStars rating={Number(average)} />
            </p>
            <p className="type-body-sm text-muted-foreground">
              {summary.count === 1 ? "1 review" : `${summary.count} reviews`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
