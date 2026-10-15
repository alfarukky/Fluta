import { ArrowLeftIcon, CircleCheckIcon, CircleXIcon, PhoneIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNaira } from "@/lib/money";
import {
  describeCustomerEstimate,
  FULFILMENT_TYPE_LABELS,
  getActorLabel,
  getQuoteRevisionLabel,
  getTimelineLabel,
  ORDER_CHANNEL_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import { formatQuantity, fromDecimalString } from "@/lib/quantity";
import { describeRevisionMoment } from "@/lib/quotes";
import { ADJUSTMENT_KIND_LABELS } from "@/schemas/orders";
import { formatCalendarDate, formatDateTime, toDateKey } from "@/lib/time";
import type { OrderDetail as OrderDetailData } from "@/server/services/orders";
import { cn } from "@/lib/utils";

import { PaymentBadge, StageBadge } from "./OrderBadges";
import { OrderStageActions } from "./OrderStageActions";
import { QuoteBanner } from "./QuoteBanner";

type Order = OrderDetailData["order"];

interface OrderDetailProps {
  detail: OrderDetailData;
  // False when the store can't work on existing orders: no moves are offered.
  canChangeStage: boolean;
  timeZone: string;
}

// Everything about one order, from the order's own copies (never the current
// service or area records), with the stage and quote actions this member may
// take. Payment actions come in later features.
export function OrderDetail({ detail, canChangeStage, timeZone }: OrderDetailProps) {
  const { order, displayNumber, balance, quote } = detail;
  const editQuoteHref = `/orders/${order.id}/quote`;

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <header className="flex flex-col gap-component">
        <Button asChild variant="link" className="h-auto self-start px-0">
          <Link href="/orders">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            All orders
          </Link>
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="type-h1 text-foreground">Order {displayNumber}</h1>
          <p className="type-body break-words text-foreground">{order.customer.name}</p>
          <p className="type-body-sm text-muted-foreground">
            Created {formatDateTime(order.createdAt, timeZone)} · {ORDER_CHANNEL_LABELS[order.channel]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={order.stage} />
          <PaymentBadge state={balance.state} />
        </div>
        {canChangeStage && (
          <OrderStageActions
            orderId={order.id}
            stage={order.stage}
            fulfilmentType={order.fulfilmentType}
            // The quote banner explains a pending or declined quote itself.
            moves={quote.pending || quote.declined ? { ...detail.stageMoves, blockedReason: null } : detail.stageMoves}
            quote={{
              editQuoteHref: quote.canEdit ? editQuoteHref : null,
              priceOrder: quote.needsPricing,
              address: quote.canEdit && order.fulfilmentType === "PICKUP_DELIVERY" ? (order.addressText ?? "") : null,
            }}
          />
        )}
      </header>

      {canChangeStage && quote.pending && (
        <QuoteBanner
          kind="pending"
          orderId={order.id}
          stage={order.stage}
          approvedTotal={quote.approvedTotal}
          revision={quote.pending}
        />
      )}
      {canChangeStage && !quote.pending && quote.declined && (
        <QuoteBanner
          kind="declined"
          orderId={order.id}
          stage={order.stage}
          approvedTotal={quote.approvedTotal}
          revision={quote.declined}
          editQuoteHref={quote.canEdit ? editQuoteHref : null}
          cancelMove={detail.stageMoves.secondary.find((move) => move.kind === "CANCEL") ?? null}
        />
      )}

      <div className="grid grid-cols-1 items-start gap-grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-grid">
          <OrderSummarySection order={order} proposed={quote.pending ?? quote.declined} />
          <PaymentsSection detail={detail} timeZone={timeZone} />
          <QuoteHistorySection order={order} timeZone={timeZone} />
        </div>
        <div className="flex min-w-0 flex-col gap-grid">
          <CustomerSection order={order} />
          <FulfilmentSection order={order} />
          <InternalNoteSection note={order.internalNote} />
          <TimelineSection detail={detail} timeZone={timeZone} />
        </div>
      </div>
    </main>
  );
}

type Revision = Order["quoteRevisions"][number];

// While a revision is pending or declined, the lines are its proposal: the
// money still follows the last approved total.
function OrderSummarySection({ order, proposed }: { order: Order; proposed: Revision | null }) {
  const services = order.lines.filter((line) => line.lineType === "SERVICE");
  const others = order.lines.filter((line) => line.lineType === "ADJUSTMENT");
  const pickup = order.fulfilmentType === "PICKUP_DELIVERY";
  const estimate = order.quoteRevisions.find((revision) => revision.version === 1);

  return (
    <Section title="Order summary" badge={proposed && <Badge variant="warning">Proposed changes</Badge>}>
      <ul className="flex flex-col divide-y divide-border">
        {services.map((line) => {
          const pricingType = line.pricingType ?? "PER_ITEM";
          const quantity = line.quantity === null ? null : fromDecimalString(line.quantity.toString());
          const estimated =
            line.estimatedQuantity === null ? null : fromDecimalString(line.estimatedQuantity.toString());
          const unweighed = quantity === null;
          return (
            <LineRow
              key={line.id}
              label={line.description}
              detail={
                unweighed
                  ? estimated !== null
                    ? describeCustomerEstimate(estimated, pricingType)
                    : pricingType === "PER_KG"
                      ? "Not weighed yet"
                      : "To be inspected"
                  : `${formatQuantity(quantity, pricingType)} × ${formatNaira(line.unitPrice ?? 0)}`
              }
              amount={
                line.lineTotal === null ? (
                  <span className="text-muted-foreground">{pricingType === "PER_KG" ? "To be weighed" : "Quote required"}</span>
                ) : (
                  formatNaira(line.lineTotal)
                )
              }
            />
          );
        })}
        {others.map((line) => {
          const amount = line.lineTotal ?? 0;
          return (
            <LineRow
              key={line.id}
              label={line.description}
              detail={amount < 0 ? ADJUSTMENT_KIND_LABELS.DISCOUNT : ADJUSTMENT_KIND_LABELS.CHARGE}
              amount={formatNaira(amount)}
            />
          );
        })}
        {pickup && (
          <LineRow
            label="Pickup & delivery"
            amount={
              order.fulfilmentCharge === null ? (
                <span className="text-muted-foreground">Quote required</span>
              ) : (
                formatNaira(order.fulfilmentCharge)
              )
            }
          />
        )}
      </ul>

      <div className="flex flex-col gap-1 border-t border-border pt-component">
        {proposed ? (
          <>
            <div className="flex items-baseline justify-between gap-component">
              <span className="type-body-sm text-muted-foreground">Last approved total</span>
              <span className="type-body-sm text-foreground">
                {order.approvedQuote ? formatNaira(order.approvedQuote.total) : "None yet"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-component">
              <span className="type-label text-foreground">Proposed total</span>
              <span className="type-h3 text-foreground">{formatNaira(proposed.total)}</span>
            </div>
            <p className="type-caption text-muted-foreground">
              {proposed.status === "DECLINED"
                ? "The customer declined these changes. Payments follow the last approved total."
                : "Waiting for the customer's approval. Payments follow the last approved total until then."}
            </p>
          </>
        ) : order.approvedQuote ? (
          <div className="flex items-baseline justify-between gap-component">
            <span className="type-label text-foreground">Approved total</span>
            <span className="type-h3 text-foreground">{formatNaira(order.approvedQuote.total)}</span>
          </div>
        ) : order.stage === "CANCELLED" ? (
          <>
            <div className="flex items-baseline justify-between gap-component">
              <span className="type-label text-foreground">Total</span>
              <span className="type-h3 text-foreground">Not priced</span>
            </div>
            <p className="type-caption text-muted-foreground">Cancelled before the store priced it.</p>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-component">
              <span className="type-label text-foreground">Total</span>
              <span className="type-h3 text-foreground">Awaiting quote</span>
            </div>
            {estimate && (
              <p className="type-caption text-muted-foreground">
                Indicative total {formatNaira(estimate.total)}. Not final: the price is set after the store weighs or
                inspects the items.
              </p>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function CustomerSection({ order }: { order: Order }) {
  const { name, phone, email } = order.customer;
  return (
    <Section title="Customer">
      <Detail label="Name" value={name} />
      <div className="flex flex-wrap items-end justify-between gap-component">
        <Detail label="Phone" value={formatPhone(phone)} />
        <Button asChild variant="outline">
          <a href={`tel:${phone}`}>
            <PhoneIcon data-icon="inline-start" aria-hidden />
            Call
          </a>
        </Button>
      </div>
      {email && <Detail label="Email" value={email} />}
    </Section>
  );
}

function FulfilmentSection({ order }: { order: Order }) {
  const pickup = order.fulfilmentType === "PICKUP_DELIVERY";
  const confirmed = order.pickupWindowStatus === "CONFIRMED";
  const pickupDate = order.scheduledPickupDate ?? order.requestedPickupDate;

  return (
    <Section title="Fulfilment">
      <Detail label="Type" value={FULFILMENT_TYPE_LABELS[order.fulfilmentType]} />
      {order.isOutsideSchedule && (
        <Badge variant="warning" className="self-start">
          Outside normal schedule
        </Badge>
      )}
      {pickup && (
        <>
          <Detail
            label="Area"
            value={
              <span className="flex flex-wrap items-center gap-2">
                {order.serviceAreaName ?? "—"}
                {order.isOutOfArea && <Badge variant="warning">Outside our service areas</Badge>}
              </span>
            }
          />
          <Detail label="Address" value={order.addressText ?? "—"} />
          <Detail label="Pickup date" value={pickupDate ? formatCalendarDate(toDateKey(pickupDate)) : "—"} />
          <Detail
            label="Requested window"
            value={formatWindow(order.requestedWindowStart, order.requestedWindowEnd) ?? "—"}
          />
          <Detail
            label="Confirmed window"
            value={
              (confirmed && formatWindow(order.scheduledWindowStart, order.scheduledWindowEnd)) || "Not confirmed yet"
            }
          />
        </>
      )}
    </Section>
  );
}

function formatWindow(start: string | null, end: string | null): string | null {
  return start && end ? formatPickupWindow({ start, end }) : null;
}

function InternalNoteSection({ note }: { note: string | null }) {
  return (
    <Section title="Internal note" badge={<Badge variant="neutral">Staff only</Badge>}>
      {note ? (
        <p className="type-body-sm break-words whitespace-pre-line text-foreground">{note}</p>
      ) : (
        <p className="type-body-sm text-muted-foreground">No note.</p>
      )}
      <p className="type-caption text-muted-foreground">Never shown to customers.</p>
    </Section>
  );
}

function TimelineSection({ detail, timeZone }: { detail: OrderDetailData; timeZone: string }) {
  const staffName = (id: string | null) => (id ? (detail.staffNames.get(id) ?? null) : null);
  return (
    <Section title="Timeline">
      <ol className="flex flex-col gap-1">
        {detail.timeline.map((entry) =>
          entry.kind === "stage" ? (
            <li key={entry.key} className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0">
              <span className="type-label text-foreground">{getTimelineLabel(entry.event, detail.order.fulfilmentType)}</span>
              <span className="type-caption text-muted-foreground">
                {formatDateTime(entry.at, timeZone)} · {getActorLabel(entry.event.actorType, staffName(entry.event.actorUserId))}
              </span>
              {entry.event.note && <span className="type-body-sm break-words text-foreground">{entry.event.note}</span>}
            </li>
          ) : (
            // Revision moments stand out with a soft tint and an icon, never colour alone.
            <li key={entry.key} className="my-1 flex gap-2.5 rounded-md bg-info/10 px-3 py-2.5">
              <RevisionIcon moment={entry.moment} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-label break-words text-foreground">
                  {describeRevisionMoment(entry, staffName(entry.staffUserId))}
                </span>
                <span className="type-caption text-muted-foreground">
                  {formatDateTime(entry.at, timeZone)}
                  {entry.moment === "ISSUED" && ` · ${getActorLabel("STAFF", staffName(entry.staffUserId))}`}
                </span>
                {entry.moment === "ISSUED" && entry.reason && (
                  <span className="type-body-sm break-words text-foreground">Reason: {entry.reason}</span>
                )}
              </div>
            </li>
          ),
        )}
      </ol>
    </Section>
  );
}

function RevisionIcon({ moment }: { moment: "ISSUED" | "APPROVED" | "DECLINED" }) {
  const Icon = moment === "ISSUED" ? ReceiptTextIcon : moment === "APPROVED" ? CircleCheckIcon : CircleXIcon;
  return <Icon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />;
}

function QuoteHistorySection({ order, timeZone }: { order: Order; timeZone: string }) {
  return (
    <Section title="Quote history">
      <ul className="flex flex-col divide-y divide-border">
        {order.quoteRevisions.map((revision) => (
          <LineRow
            key={revision.id}
            label={`Version ${revision.version}`}
            detail={[
              getQuoteRevisionLabel(revision),
              formatDateTime(revision.createdAt, timeZone),
              revision.version > 1 && revision.reason ? `Reason: ${revision.reason}` : null,
              revision.status === "DECLINED" && revision.customerMessage ? `Customer said: “${revision.customerMessage}”` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            amount={formatNaira(revision.total)}
          />
        ))}
      </ul>
    </Section>
  );
}

function PaymentsSection({ detail, timeZone }: { detail: OrderDetailData; timeZone: string }) {
  const { order, balance } = detail;
  // Failed attempts aren't payments; they never show here.
  const payments = order.payments.filter((payment) => payment.status !== "FAILED");
  const empty = payments.length === 0 && order.refunds.length === 0;

  return (
    <Section title="Payments">
      {empty ? (
        <p className="type-body-sm text-muted-foreground">No payments recorded yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {payments.map((payment) => {
            const voided = payment.status === "VOIDED" || payment.voidedAt !== null;
            const status = voided ? "Voided" : payment.status === "CONFIRMED" ? "Confirmed" : "Pending";
            const reference = payment.paystackReference ?? payment.note;
            return (
              <LineRow
                key={payment.id}
                voided={voided}
                label={PAYMENT_METHOD_LABELS[payment.method]}
                detail={[status, formatDateTime(payment.confirmedAt ?? payment.createdAt, timeZone), reference]
                  .filter(Boolean)
                  .join(" · ")}
                amount={formatNaira(payment.amount)}
              />
            );
          })}
          {order.refunds.map((refund) => {
            const voided = refund.voidedAt !== null;
            return (
              <LineRow
                key={refund.id}
                voided={voided}
                label="Refund paid"
                detail={[voided ? "Voided" : null, formatDateTime(refund.paidAt, timeZone), refund.note]
                  .filter(Boolean)
                  .join(" · ")}
                amount={formatNaira(-refund.amount)}
              />
            );
          })}
        </ul>
      )}

      <dl className="flex flex-col gap-1 border-t border-border pt-component">
        <Total label="Confirmed payments" value={formatNaira(balance.confirmedPaymentsKobo)} />
        {balance.paidRefundsKobo > 0 && <Total label="Refunds paid" value={formatNaira(balance.paidRefundsKobo)} />}
        {balance.balanceKobo === null ? (
          <Total label="Balance" value="Awaiting quote" />
        ) : balance.state === "NOTHING_DUE" ? (
          <Total label="Balance" value="Nothing due" strong />
        ) : balance.balanceKobo < 0 ? (
          <Total label="Refund owed" value={formatNaira(-balance.balanceKobo)} strong />
        ) : (
          <Total label="Balance due" value={formatNaira(balance.balanceKobo)} strong />
        )}
      </dl>
      {!empty && <p className="type-caption text-muted-foreground">Voided records are crossed out and not counted.</p>}
    </Section>
  );
}

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-component">
      <dt className={cn("type-body-sm text-muted-foreground", strong && "type-label text-foreground")}>{label}</dt>
      <dd className={cn("type-body-sm text-foreground", strong && "type-label")}>{value}</dd>
    </div>
  );
}

function Section({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="type-h3">
          <h2>{title}</h2>
        </CardTitle>
        {badge}
      </CardHeader>
      <CardContent className="flex flex-col gap-component">{children}</CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="type-caption text-muted-foreground">{label}</span>
      <span className="type-body-sm break-words text-foreground">{value}</span>
    </div>
  );
}

interface LineRowProps {
  label: string;
  detail?: string;
  amount: ReactNode;
  voided?: boolean;
}

function LineRow({ label, detail, amount, voided = false }: LineRowProps) {
  return (
    <li className={cn("flex items-start justify-between gap-component py-2.5 first:pt-0 last:pb-0", voided && "line-through")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="type-body-sm break-words text-foreground">{label}</span>
        {detail && <span className="type-caption break-words text-muted-foreground">{detail}</span>}
      </div>
      <span className="type-body-sm shrink-0 text-right text-foreground">{amount}</span>
    </li>
  );
}
