import { CalendarClockIcon, CircleCheckIcon, CircleDotIcon, CircleIcon, PhoneIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TrackingItem, TrackingTimelineStep, TrackingView } from "@/types/tracking";

import { ConfirmingPayment } from "./ConfirmingPayment";
import { PayNowCard } from "./PayNowCard";

interface TrackingOrderProps {
  view: TrackingView;
  // "/o/{token}", for the review screens.
  basePath: string;
  // The link's token, for Pay now. Never logged.
  token: string;
  // Back from Paystack with this order's attempt still PENDING.
  confirmingPayment?: boolean;
}

// The customer's order, in plain words: where it is, what it costs, and
// anything waiting for them as one calm card at the top.
export function TrackingOrder({ view, basePath, token, confirmingPayment = false }: TrackingOrderProps) {
  const { store } = view;
  return (
    <>
      <section aria-labelledby="order-heading" className="flex flex-col gap-1">
        <p className="type-label text-muted-foreground">Order {view.displayNumber}</p>
        <h2 id="order-heading" className="type-h1 text-foreground">
          {view.stageLabel}
        </h2>
        {view.closed && <p className="type-body-sm text-muted-foreground">This page is view only.</p>}
      </section>

      {!view.closed && <ActionCard view={view} basePath={basePath} />}

      {confirmingPayment ? <ConfirmingPayment /> : view.payNow && <PayNowCard token={token} offer={view.payNow} />}

      <Card title="Progress">
        <Timeline steps={view.timeline} />
      </Card>

      <Card title="Payment">
        <p className="type-h3 text-card-foreground">{view.payment}</p>
        <Price view={view} />
      </Card>

      {view.pickup ? (
        <Card title="Pickup">
          <dl className="flex flex-col gap-component">
            {view.pickup.area && <Detail label="Area" value={view.pickup.area} />}
            <Detail
              label="When"
              value={
                <span className="flex flex-col items-start gap-1">
                  <span>{[view.pickup.date, view.pickup.time].filter(Boolean).join(" · ")}</span>
                  <Badge variant={view.pickup.status === "Confirmed" ? "success" : "neutral"}>{view.pickup.status}</Badge>
                </span>
              }
            />
          </dl>
        </Card>
      ) : (
        <Card title="Drop-off">
          <p className="type-body-sm text-card-foreground">Bring your laundry to {store.name} and mention your order number.</p>
        </Card>
      )}

      <Card title="Your details">
        <dl className="flex flex-col gap-component">
          <Detail label="Phone" value={view.maskedPhone} />
        </dl>
      </Card>

      {store.phone && store.phoneHref && (
        <div className="flex flex-col items-start gap-2">
          <p className="type-body-sm text-muted-foreground">Questions about your order? Contact {store.name}.</p>
          <Button asChild variant="outline">
            <a href={store.phoneHref}>
              <PhoneIcon data-icon="inline-start" aria-hidden />
              Call {store.phone}
            </a>
          </Button>
        </div>
      )}
    </>
  );
}

function ActionCard({ view, basePath }: Pick<TrackingOrderProps, "view" | "basePath">) {
  const card = view.priceUpdate
    ? { icon: ReceiptTextIcon, title: "Price update ready for your approval", href: `${basePath}/price-update` }
    : view.pickupSuggestion
      ? { icon: CalendarClockIcon, title: "The store suggested a new pickup time", href: `${basePath}/pickup-time` }
      : null;
  if (!card) return null;
  const Icon = card.icon;
  return (
    <section aria-labelledby="action-heading" className="flex flex-col gap-component rounded-xl border border-primary/40 bg-primary/5 p-card">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <h2 id="action-heading" className="type-label text-foreground">
          {card.title}
        </h2>
      </div>
      <Button asChild className="self-start">
        <Link href={card.href}>Review</Link>
      </Button>
    </section>
  );
}

const UNPRICED = "The store will confirm the price";

const STEP_ICONS = { done: CircleCheckIcon, current: CircleDotIcon, upcoming: CircleIcon } as const;
const STEP_STATE_LABELS = { done: "Done", current: "Now", upcoming: "Coming up" } as const;

function Timeline({ steps }: { steps: TrackingTimelineStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step) => {
        const Icon = STEP_ICONS[step.state];
        return (
          <li key={step.key} className="flex gap-3 py-1.5" aria-current={step.state === "current" ? "step" : undefined}>
            <Icon
              className={cn(
                "mt-0.5 size-5 shrink-0",
                step.state === "done" && "text-success",
                step.state === "current" && "text-primary",
                step.state === "upcoming" && "text-muted-foreground",
              )}
              aria-hidden
            />
            <div className="flex min-w-0 flex-col">
              <span
                className={cn(
                  "type-body-sm",
                  step.state === "upcoming" ? "text-muted-foreground" : "text-card-foreground",
                  step.state === "current" && "font-semibold",
                )}
              >
                <span className="sr-only">{STEP_STATE_LABELS[step.state]}: </span>
                {step.label}
              </span>
              {step.at && <span className="type-caption text-muted-foreground">{step.at}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Price({ view }: { view: TrackingView }) {
  const { price } = view;
  return (
    <div className="flex flex-col gap-component">
      <ItemList items={price.items} />
      {price.kind === "approved" && (
        <div className="flex flex-col gap-1 border-t border-border pt-component">
          {price.charge && <Row label="Pickup & delivery" value={price.charge} />}
          <Row label="Total" value={price.total} strong />
        </div>
      )}
      {price.kind === "estimate" && (
        <div className="flex flex-col gap-1 border-t border-border pt-component">
          <Row label="Estimated total" value={price.total} strong />
          <p className="type-caption text-muted-foreground">The store will confirm the price after weighing or checking your items.</p>
        </div>
      )}
      {/* The payment line may already say it (nothing approved yet). */}
      {price.kind === "unknown" && view.payment !== UNPRICED && (
        <p className="type-body-sm border-t border-border pt-component text-muted-foreground">{UNPRICED}.</p>
      )}
    </div>
  );
}

export function ItemList({ items }: { items: TrackingItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => (
        <li key={item.key} className="flex items-start justify-between gap-component py-2.5 first:pt-0 last:pb-0">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="type-body-sm break-words text-card-foreground">{item.name}</span>
            {item.detail && <span className="type-caption break-words text-muted-foreground">{item.detail}</span>}
          </div>
          {item.amount && <span className="type-body-sm shrink-0 text-right text-card-foreground">{item.amount}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-component">
      <span className={cn("type-body-sm text-muted-foreground", strong && "type-label text-card-foreground")}>{label}</span>
      <span className={cn("type-body-sm text-card-foreground", strong && "type-h3")}>{value}</span>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-component rounded-xl border border-border bg-card p-card">
      <h2 className="type-label text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="type-caption text-muted-foreground">{label}</dt>
      <dd className="type-body-sm break-words text-card-foreground">{value}</dd>
    </div>
  );
}
