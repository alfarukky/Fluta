import { Badge } from "@/components/ui/badge";
import { formatNaira } from "@/lib/money";
import { ORDER_STAGE_LABELS } from "@/lib/orders";

import type { OrderReview } from "./order-draft";
import { OrderSection } from "./OrderSection";

interface ReviewSectionProps {
  review: OrderReview;
  showCharge: boolean;
}

// A preview: the server recomputes every amount when the order is created.
export function ReviewSection({ review, showCharge }: ReviewSectionProps) {
  const rows = [
    ...review.serviceLines.map((line) => ({
      key: line.key,
      label: line.description,
      value: line.awaitingWeight ? "Weigh later" : line.lineTotal === null ? "—" : formatNaira(line.lineTotal),
    })),
    ...review.adjustments.map((line) => ({
      key: line.key,
      label: line.description,
      value: line.amount === null ? "—" : formatNaira(line.amount),
    })),
    ...(showCharge
      ? [
          {
            key: "charge",
            label: "Pickup & delivery",
            value: review.fulfilmentCharge === null ? "To be entered" : formatNaira(review.fulfilmentCharge),
          },
        ]
      : []),
  ];

  return (
    <OrderSection title="Review">
      {rows.length > 0 && (
        <dl className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-component">
              <dt className="type-body-sm min-w-0 truncate text-muted-foreground">{row.label}</dt>
              <dd className="type-body-sm shrink-0 text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-baseline justify-between gap-component border-t border-border pt-component">
        <span className="type-label text-foreground">{review.fullyPriced ? "Total" : "Total so far"}</span>
        <span className="type-h3 text-foreground" aria-live="polite">
          {formatNaira(review.total)}
        </span>
      </div>
      {!review.fullyPriced && (
        <p className="type-caption text-muted-foreground">
          Some lines still need weighing, so this is an estimate. The priced quote comes after weighing.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-body-sm text-muted-foreground">Starts at</span>
        <Badge variant="info">{ORDER_STAGE_LABELS[review.stage]}</Badge>
      </div>
    </OrderSection>
  );
}
