import {
  ArrowLeftIcon,
  BanknoteArrowUpIcon,
  BanknoteIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  CircleXIcon,
  PhoneIcon,
  PrinterIcon,
  ReceiptTextIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { RatingStars } from "@/components/reviews/RatingStars";
import { OpenInMapsButton } from "@/components/shared/OpenInMapsButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  describeMessageStatus,
  getMessageTemplateLabel,
  isCustomerMessageTemplate,
  isFinallyFailed,
  MESSAGE_CHANNEL_LABELS,
} from "@/lib/messages";
import type { Coordinates } from "@/lib/location";
import { formatNaira } from "@/lib/money";
import { isMismatchCode } from "@/lib/online-payment";
import {
  describeCustomerEstimate,
  FULFILMENT_TYPE_LABELS,
  getActorLabel,
  getQuoteRevisionLabel,
  getTimelineLabel,
  ORDER_CHANNEL_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/orders";
import { getOrderQuotePath, getOrderReceiptPath } from "@/lib/order-links";
import { describeBalance, describePaymentRecorded, describePaymentVoided, PAYMENT_SOURCE_LABELS } from "@/lib/payments";
import { formatPhone } from "@/lib/phone";
import {
  describeRefundRecorded,
  describeRefundVoided,
  FLUTA_FEE_NOT_REFUNDED,
  getRefundableKobo,
  REFUND_METHODS,
} from "@/lib/refunds";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import { fromStoredQuantity } from "@/lib/quantity";
import { describeRevisionMoment } from "@/lib/quotes";
import { describeRating } from "@/lib/reviews";
import { ADJUSTMENT_KIND_LABELS } from "@/schemas/orders";
import { formatCalendarDate, formatDateTime, fromDateKey, toDateKey } from "@/lib/time";
import type { OrderDetail as OrderDetailData } from "@/server/services/orders";
import { cn } from "@/lib/utils";

import { CustomerMessageActions } from "./CustomerMessageActions";
import { OutOfAreaBadge, PaymentBadge, StageBadge } from "./OrderBadges";
import { OrderStageActions } from "./OrderStageActions";
import { PickupTimeCard, type PickupTimeOptions } from "./PickupTimeCard";
import { QuoteBanner } from "./QuoteBanner";
import { RecordPaymentButton } from "./RecordPaymentButton";
import { RecordRefundButton } from "./RecordRefundButton";
import { SendAgainButton } from "./SendAgainButton";
import { TrackingLinkButton } from "./TrackingLinkButton";
import { VoidPaymentButton } from "./VoidPaymentButton";
import { VoidRefundButton } from "./VoidRefundButton";

type Order = OrderDetailData["order"];

interface OrderDetailProps {
  detail: OrderDetailData;
  // False when the store can't work on existing orders: no moves are offered.
  canChangeStage: boolean;
  timeZone: string;
  // The store's schedule for "Suggest another time", when it can be used.
  pickupOptions: PickupTimeOptions | null;
}

// Everything about one order, from the order's own copies (never the current
// service or area records), with the stage, quote, and payment actions this
// member may take.
export function OrderDetail({ detail, canChangeStage, timeZone, pickupOptions }: OrderDetailProps) {
  const { order, displayNumber, balance, quote, pickupTime } = detail;
  const editQuoteHref = getOrderQuotePath(order.id);
  // Ready or Completed with a balance due: Record payment is the main action.
  const recordPrimary = canChangeStage && detail.payments.canRecord && detail.payments.recordPrimary;
  // Refund owed, at any stage: Record refund is the main action.
  const refundPrimary = canChangeStage && detail.refunds.owedKobo > 0;

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
          <p className="type-body wrap-break-word text-foreground">{order.customer.name}</p>
          <p className="type-body-sm text-muted-foreground">
            Created {formatDateTime(order.createdAt, timeZone)} · {ORDER_CHANNEL_LABELS[order.channel]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={order.stage} />
          <PaymentBadge state={balance.state} />
        </div>
        {(canChangeStage || detail.hasReceipt) && (
          <div className="flex flex-wrap items-start gap-2">
            {refundPrimary && <RecordRefundButton orderId={order.id} owedKobo={detail.refunds.owedKobo} primary />}
            {recordPrimary && (
              <RecordPaymentButton orderId={order.id} balance={balance} primary pendingOnline={detail.payments.hasPendingOnlinePayment} />
            )}
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
                quietPrimary={recordPrimary || refundPrimary}
              />
            )}
            {/* Once the order has an active confirmed payment. */}
            {detail.hasReceipt && (
              <Button asChild variant="outline">
                <Link href={getOrderReceiptPath(order.id)}>
                  <PrinterIcon data-icon="inline-start" aria-hidden />
                  Print receipt
                </Link>
              </Button>
            )}
          </div>
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

      {canChangeStage && pickupTime && (
        <PickupTimeCard
          orderId={order.id}
          status={pickupTime.status}
          requested={formatPickup(order.requestedPickupDate, order.requestedWindowStart, order.requestedWindowEnd)}
          suggested={
            pickupTime.status === "PROPOSED_BY_STORE"
              ? formatPickup(order.scheduledPickupDate, order.scheduledWindowStart, order.scheduledWindowEnd)
              : null
          }
          canConfirm={pickupTime.canConfirm}
          canSuggest={pickupTime.canSuggest}
          blockedReason={pickupTime.blockedReason}
          options={pickupOptions}
        />
      )}

      {order.review && <ReviewSection review={order.review} timeZone={timeZone} />}

      <div className="grid grid-cols-1 items-start gap-grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-grid">
          <OrderSummarySection order={order} proposed={quote.pending ?? quote.declined} />
          {order.customerNote && <CustomerNoteSection note={order.customerNote} />}
          <PaymentsSection detail={detail} canChangeStage={canChangeStage} timeZone={timeZone} />
          <QuoteHistorySection order={order} timeZone={timeZone} />
        </div>
        <div className="flex min-w-0 flex-col gap-grid">
          <CustomerSection detail={detail} canChangeStage={canChangeStage} />
          <MessagesSection order={order} canSendAgain={canChangeStage} timeZone={timeZone} />
          <FulfilmentSection order={order} location={detail.location} />
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
          const quantity = line.quantity === null ? null : fromStoredQuantity(line.quantity.toString());
          const estimated =
            line.estimatedQuantity === null ? null : fromStoredQuantity(line.estimatedQuantity.toString());
          return (
            <LineRow
              key={line.id}
              label={line.description}
              detail={
                quantity === null
                  ? estimated !== null
                    ? describeCustomerEstimate(estimated)
                    : "To be inspected"
                  : `${quantity} × ${formatNaira(line.unitPrice ?? 0)}`
              }
              amount={
                line.lineTotal === null ? (
                  <span className="text-muted-foreground">Quote required</span>
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
                Indicative total {formatNaira(estimate.total)}. Not final: the price is set after the store inspects
                the items.
              </p>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function CustomerSection({ detail, canChangeStage }: { detail: OrderDetailData; canChangeStage: boolean }) {
  const { order } = detail;
  const { name, phone, email } = order.customer;
  const canIssueTrackingLink = canChangeStage && detail.canIssueTrackingLink;
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
      {canIssueTrackingLink && (
        <div className="flex flex-col items-start gap-1 border-t border-border pt-component">
          <TrackingLinkButton orderId={order.id} />
          <p className="type-caption text-muted-foreground">The customer follows the order, approves prices, and accepts pickup times there.</p>
        </div>
      )}
      {canChangeStage && (
        <CustomerMessageActions
          orderId={order.id}
          canIssueLink={detail.canIssueTrackingLink}
          canSendLinkBySms={detail.canSendLinkBySms}
          whatsappEnabled={detail.whatsappEnabled}
        />
      )}
    </Section>
  );
}

// Every message to the customer, newest first, by its own channel's words.
// SENT means the provider accepted it, never that it arrived.
function MessagesSection({ order, canSendAgain, timeZone }: { order: Order; canSendAgain: boolean; timeZone: string }) {
  const messages = order.messageEvents;
  return (
    <Section title="Messages">
      {messages.length === 0 ? (
        <p className="type-body-sm text-muted-foreground">No messages to the customer yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {messages.map((message) => {
            const status = describeMessageStatus(message);
            const label = `${getMessageTemplateLabel(message.template)} · ${MESSAGE_CHANNEL_LABELS[message.channel]}`;
            return (
              <li key={message.id} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="type-body-sm wrap-break-word text-foreground">{label}</span>
                    <span className="type-caption text-muted-foreground">
                      {formatDateTime(message.sentAt ?? message.createdAt, timeZone)}
                    </span>
                  </div>
                  <Badge variant={status.tone}>{status.label}</Badge>
                </div>
                {/* Never for the review reminder: it is sent once only. */}
                {canSendAgain && isCustomerMessageTemplate(message.template) && isFinallyFailed(message) && (
                  <div>
                    <SendAgainButton orderId={order.id} messageId={message.id} label={label} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

const PICKUP_STATUS_LABELS = {
  REQUESTED: "Requested",
  PROPOSED_BY_STORE: "Suggested by the store",
  CONFIRMED: "Confirmed",
} as const;

function FulfilmentSection({ order, location }: { order: Order; location: Coordinates | null }) {
  const pickup = order.fulfilmentType === "PICKUP_DELIVERY";
  const status = order.pickupWindowStatus;

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
                {order.isOutOfArea && <OutOfAreaBadge />}
              </span>
            }
          />
          <Detail label="Address" value={order.addressText ?? "—"} />
          {location && <OpenInMapsButton location={location} className="self-start" />}
          <Detail label="Pickup time" value={status ? PICKUP_STATUS_LABELS[status] : "—"} />
          <Detail
            label="Customer asked for"
            value={formatPickup(order.requestedPickupDate, order.requestedWindowStart, order.requestedWindowEnd)}
          />
          {status === "PROPOSED_BY_STORE" && (
            <Detail
              label="Suggested by the store"
              value={formatPickup(order.scheduledPickupDate, order.scheduledWindowStart, order.scheduledWindowEnd)}
            />
          )}
          <Detail
            label="Confirmed pickup"
            value={
              status === "CONFIRMED"
                ? formatPickup(order.scheduledPickupDate, order.scheduledWindowStart, order.scheduledWindowEnd)
                : "Not confirmed yet"
            }
          />
        </>
      )}
    </Section>
  );
}

// "Tue, 20 Oct 2026 · 10:00 AM–12:00 PM", or "—" when there is none.
function formatPickup(date: Date | null, start: string | null, end: string | null): string {
  if (!date) return "—";
  const day = formatCalendarDate(toDateKey(date));
  return start && end ? `${day} · ${formatPickupWindow({ start, end })}` : day;
}

// The customer's review (Feature 19b): private to the store. The comment is
// plain text, shown as typed (React escapes it).
function ReviewSection({ review, timeZone }: { review: NonNullable<Order["review"]>; timeZone: string }) {
  return (
    <Section title="Customer review">
      <div className="flex flex-col gap-1">
        <RatingStars rating={review.rating} label={describeRating(review.rating)} />
        <p className="type-caption text-muted-foreground">{formatDateTime(review.createdAt, timeZone)}</p>
      </div>
      {review.comment ? (
        <p className="type-body-sm wrap-break-word whitespace-pre-line text-foreground">{review.comment}</p>
      ) : (
        <p className="type-body-sm text-muted-foreground">No comment.</p>
      )}
    </Section>
  );
}

// What the customer wrote under "Anything else?" when booking online. Plain
// text (React escapes it), and never priced: anything extra goes through a
// quote the customer approves.
function CustomerNoteSection({ note }: { note: string }) {
  return (
    <Section title="Customer's note" badge={<Badge variant="info">From booking</Badge>}>
      <p className="type-body-sm wrap-break-word whitespace-pre-line text-foreground">{note}</p>
      <p className="type-caption text-muted-foreground">Not priced. Add anything extra to the quote.</p>
    </Section>
  );
}

function InternalNoteSection({ note }: { note: string | null }) {
  return (
    <Section title="Internal note" badge={<Badge variant="neutral">Staff only</Badge>}>
      {note ? (
        <p className="type-body-sm wrap-break-word whitespace-pre-line text-foreground">{note}</p>
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
          entry.kind === "payment" ? (
            <li key={entry.key} className="my-1 flex gap-2.5 rounded-md bg-success/10 px-3 py-2.5">
              <BanknoteIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-label wrap-break-word text-foreground">
                  {entry.moment === "RECORDED"
                    ? describePaymentRecorded(entry.payment, staffName(entry.staffUserId))
                    : describePaymentVoided(entry.payment, staffName(entry.staffUserId))}
                </span>
                <span className="type-caption text-muted-foreground">{formatDateTime(entry.at, timeZone)}</span>
                {entry.moment === "VOIDED" && entry.payment.voidReason && (
                  <span className="type-body-sm wrap-break-word text-foreground">Reason: {entry.payment.voidReason}</span>
                )}
              </div>
            </li>
          ) : entry.kind === "refund" ? (
            <li key={entry.key} className="my-1 flex gap-2.5 rounded-md bg-info/10 px-3 py-2.5">
              <BanknoteArrowUpIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-label wrap-break-word text-foreground">
                  {entry.moment === "RECORDED"
                    ? describeRefundRecorded(entry.refund, staffName(entry.staffUserId))
                    : describeRefundVoided(entry.refund, staffName(entry.staffUserId))}
                </span>
                <span className="type-caption text-muted-foreground">{formatDateTime(entry.at, timeZone)}</span>
                {entry.moment === "VOIDED" && entry.refund.voidReason && (
                  <span className="type-body-sm wrap-break-word text-foreground">Reason: {entry.refund.voidReason}</span>
                )}
              </div>
            </li>
          ) : entry.kind === "stage" ? (
            <li key={entry.key} className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0">
              <span className="type-label text-foreground">{getTimelineLabel(entry.event, detail.order.fulfilmentType)}</span>
              <span className="type-caption text-muted-foreground">
                {formatDateTime(entry.at, timeZone)} · {getActorLabel(entry.event.actorType, staffName(entry.event.actorUserId))}
              </span>
              {entry.event.note && <span className="type-body-sm wrap-break-word text-foreground">{entry.event.note}</span>}
            </li>
          ) : entry.kind === "pickupReset" ? (
            <li key={entry.key} className="my-1 flex gap-2.5 rounded-md bg-warning/10 px-3 py-2.5">
              <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-label wrap-break-word text-foreground">Pickup time back to the customer&apos;s request</span>
                <span className="type-caption text-muted-foreground">
                  {formatDateTime(entry.at, timeZone)} · {getActorLabel("STAFF", staffName(entry.reset.actorUserId))}
                </span>
                {entry.reset.date && (
                  <span className="type-body-sm wrap-break-word text-foreground">
                    Cleared: {formatPickup(fromDateKey(entry.reset.date), entry.reset.windowStart, entry.reset.windowEnd)}
                    {entry.reset.isOutsideSchedule && " (outside normal schedule)"}
                  </span>
                )}
              </div>
            </li>
          ) : entry.kind === "pickupSuggested" ? (
            <li key={entry.key} className="my-1 flex gap-2.5 rounded-md bg-warning/10 px-3 py-2.5">
              <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-label wrap-break-word text-foreground">
                  Pickup time suggested: {formatCalendarDate(entry.suggestion.date)} ·{" "}
                  {formatPickupWindow({ start: entry.suggestion.windowStart, end: entry.suggestion.windowEnd })}
                </span>
                <span className="type-caption text-muted-foreground">
                  {formatDateTime(entry.at, timeZone)} · {getActorLabel("STAFF", staffName(entry.suggestion.actorUserId))}
                </span>
                {entry.suggestion.isOutsideSchedule && (
                  <Badge variant="warning" className="self-start">
                    Outside normal schedule
                  </Badge>
                )}
                {entry.suggestion.note && (
                  <span className="type-body-sm wrap-break-word text-foreground">Note: {entry.suggestion.note}</span>
                )}
              </div>
            </li>
          ) : (
            // Revision moments stand out with a soft tint and an icon, never colour alone.
            <li key={entry.key} className="my-1 flex gap-2.5 rounded-md bg-info/10 px-3 py-2.5">
              <RevisionIcon moment={entry.moment} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-label wrap-break-word text-foreground">
                  {describeRevisionMoment(entry, staffName(entry.staffUserId))}
                </span>
                <span className="type-caption text-muted-foreground">
                  {formatDateTime(entry.at, timeZone)}
                  {entry.moment === "ISSUED" && ` · ${getActorLabel("STAFF", staffName(entry.staffUserId))}`}
                </span>
                {entry.moment === "ISSUED" && entry.reason && (
                  <span className="type-body-sm wrap-break-word text-foreground">Reason: {entry.reason}</span>
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

function PaymentsSection({
  detail,
  canChangeStage,
  timeZone,
}: {
  detail: OrderDetailData;
  canChangeStage: boolean;
  timeZone: string;
}) {
  const { order, balance } = detail;
  const staffName = (id: string | null) => (id ? (detail.staffNames.get(id) ?? null) : null);
  // Failed attempts aren't payments and are hidden, except a Paystack payment
  // that didn't match: it shows as "Payment needs review" (plan 6.8).
  const payments = order.payments.filter((payment) => payment.status !== "FAILED" || isMismatchCode(payment.failureCode));
  const empty = payments.length === 0 && order.refunds.length === 0;
  const canRecord = canChangeStage && detail.payments.canRecord;
  const canVoid = canChangeStage && detail.payments.canVoid;
  const owedKobo = detail.refunds.owedKobo;
  const canRecordRefund = canChangeStage && owedKobo > 0;
  const canVoidRefund = canChangeStage && detail.refunds.canVoid;
  const last = describeBalance(balance);

  return (
    <Section
      title="Payments"
      badge={
        (canRecord || canRecordRefund) && (
          <div className="flex flex-wrap gap-2">
            {canRecordRefund && <RecordRefundButton orderId={order.id} owedKobo={owedKobo} primary={false} />}
            {canRecord && (
              <RecordPaymentButton
                orderId={order.id}
                balance={balance}
                primary={false}
                pendingOnline={detail.payments.hasPendingOnlinePayment}
              />
            )}
          </div>
        )
      }
    >
      {payments.length === 0 ? (
        <p className="type-body-sm text-muted-foreground">No payments recorded yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {payments.map((payment) => (
            <PaymentRow
              key={payment.id}
              payment={payment}
              staffName={staffName}
              timeZone={timeZone}
              // Owners void confirmed store-collected payments. Online ones never.
              voidable={canVoid && payment.source === "STORE_COLLECTED" && payment.status === "CONFIRMED"}
              balanceKobo={balance.balanceKobo}
            />
          ))}
        </ul>
      )}

      {order.refunds.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-component">
          <h3 className="type-label text-foreground">Refunds</h3>
          <ul className="flex flex-col divide-y divide-border">
            {order.refunds.map((refund) => (
              <RefundRow
                key={refund.id}
                refund={refund}
                staffName={staffName}
                timeZone={timeZone}
                voidable={canVoidRefund && refund.voidedAt === null}
                balanceKobo={balance.balanceKobo}
              />
            ))}
          </ul>
        </div>
      )}

      <dl className="flex flex-col gap-1 border-t border-border pt-component">
        {balance.balanceKobo !== null && (
          <Total label="Confirmed payments" value={formatNaira(balance.confirmedPaymentsKobo)} />
        )}
        {balance.paidRefundsKobo > 0 && <Total label="Refunds paid" value={formatNaira(balance.paidRefundsKobo)} />}
        <Total label={last.label} value={last.value} strong />
      </dl>
      {balance.balanceKobo === null && (
        <p className="type-caption text-muted-foreground">No price is approved yet, so there is no balance.</p>
      )}
      {!empty && <p className="type-caption text-muted-foreground">Voided records are crossed out and not counted.</p>}
    </Section>
  );
}

type OrderPayment = Order["payments"][number];

interface PaymentRowProps {
  payment: OrderPayment;
  staffName: (id: string | null) => string | null;
  timeZone: string;
  voidable: boolean;
  balanceKobo: number | null;
}

// One payment: struck through once voided, with who voided it and why (staff only).
function PaymentRow({ payment, staffName, timeZone, voidable, balanceKobo }: PaymentRowProps) {
  const voided = payment.status === "VOIDED";
  const review = payment.status === "FAILED";
  // A pending online payment has started on Paystack but isn't confirmed: not counted.
  const status = voided
    ? "Voided"
    : payment.status === "CONFIRMED"
      ? "Confirmed"
      : review
        ? null
        : "Awaiting confirmation, not counted";
  const recordedBy =
    payment.source === "STORE_COLLECTED" ? `by ${getActorLabel("STAFF", staffName(payment.recordedByUserId))}` : null;
  const reference = payment.paystackReference ?? (payment.reference && `Ref: ${payment.reference}`);
  const method = payment.method === "PAYSTACK" ? null : payment.method;

  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className={cn("flex items-start justify-between gap-component", voided && "line-through")}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="type-body-sm wrap-break-word text-foreground">
            {PAYMENT_METHOD_LABELS[payment.method]} · {PAYMENT_SOURCE_LABELS[payment.source]}
            {payment.replacesPaymentId && " · Correction"}
          </span>
          <span className="type-caption wrap-break-word text-muted-foreground">
            {[status, formatDateTime(payment.confirmedAt ?? payment.createdAt, timeZone), recordedBy, reference]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <span className="type-body-sm shrink-0 text-right text-foreground">{formatNaira(payment.amount)}</span>
      </div>
      {review && (
        <div className="flex flex-col items-start gap-1">
          <Badge variant="warning">Payment needs review</Badge>
          <p className="type-caption text-muted-foreground">
            Paystack reported this payment, but it didn&apos;t match the order, so it isn&apos;t counted. Fluta will check it with you.
          </p>
        </div>
      )}
      {payment.note && <p className="type-caption wrap-break-word text-muted-foreground">Note: {payment.note}</p>}
      {payment.source === "ONLINE" && payment.status === "CONFIRMED" && (payment.flutaFeeAmount ?? 0) > 0 && (
        <p className="type-caption text-muted-foreground">{FLUTA_FEE_NOT_REFUNDED}.</p>
      )}
      {voided && (
        <p className="type-caption wrap-break-word text-muted-foreground">
          Voided by {getActorLabel("STAFF", staffName(payment.voidedByUserId))}
          {payment.voidedAt && `, ${formatDateTime(payment.voidedAt, timeZone)}`}
          {payment.voidReason && `. Reason: ${payment.voidReason}`}
        </p>
      )}
      {voidable && method && (
        <div>
          <VoidPaymentButton
            payment={{ id: payment.id, amount: payment.amount, method, reference: payment.reference, note: payment.note }}
            balanceAfterVoidKobo={balanceKobo === null ? null : balanceKobo + payment.amount}
          />
        </div>
      )}
    </li>
  );
}

type OrderRefund = Order["refunds"][number];

interface RefundRowProps {
  refund: OrderRefund;
  staffName: (id: string | null) => string | null;
  timeZone: string;
  voidable: boolean;
  // The order's balance now; voiding this refund adds its amount back to what is owed.
  balanceKobo: number | null;
}

// One refund the store paid back: struck through once voided, with who voided
// it and why (staff only).
function RefundRow({ refund, staffName, timeZone, voidable, balanceKobo }: RefundRowProps) {
  const voided = refund.voidedAt !== null;
  const method = REFUND_METHODS.find((value) => value === refund.method);
  const detail = [
    voided ? "Voided" : null,
    formatDateTime(refund.paidAt, timeZone),
    `by ${getActorLabel("STAFF", staffName(refund.recordedByUserId))}`,
    refund.reference && `Ref: ${refund.reference}`,
  ];

  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className={cn("flex items-start justify-between gap-component", voided && "line-through")}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="type-body-sm wrap-break-word text-foreground">
            Refund · {PAYMENT_METHOD_LABELS[refund.method]}
            {refund.replacesRefundId && " · Correction"}
          </span>
          <span className="type-caption wrap-break-word text-muted-foreground">{detail.filter(Boolean).join(" · ")}</span>
        </div>
        <span className="type-body-sm shrink-0 text-right text-foreground">{formatNaira(-refund.amount)}</span>
      </div>
      <p className="type-caption wrap-break-word text-muted-foreground">Note: {refund.note}</p>
      {voided && (
        <p className="type-caption wrap-break-word text-muted-foreground">
          Voided by {getActorLabel("STAFF", staffName(refund.voidedByUserId))}
          {refund.voidedAt && `, ${formatDateTime(refund.voidedAt, timeZone)}`}
          {refund.voidReason && `. Reason: ${refund.voidReason}`}
        </p>
      )}
      {voidable && method && (
        <div>
          <VoidRefundButton
            refund={{ id: refund.id, amount: refund.amount, method, reference: refund.reference, note: refund.note }}
            owedAfterVoidKobo={getRefundableKobo(balanceKobo === null ? null : balanceKobo - refund.amount)}
          />
        </div>
      )}
    </li>
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
      <span className="type-body-sm wrap-break-word text-foreground">{value}</span>
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
        <span className="type-body-sm wrap-break-word text-foreground">{label}</span>
        {detail && <span className="type-caption wrap-break-word text-muted-foreground">{detail}</span>}
      </div>
      <span className="type-body-sm shrink-0 text-right text-foreground">{amount}</span>
    </li>
  );
}
