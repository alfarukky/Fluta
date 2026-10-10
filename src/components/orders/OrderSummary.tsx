import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/workspace/PageHeader";
import { formatNaira } from "@/lib/money";
import { FULFILMENT_TYPE_LABELS, ORDER_CHANNEL_LABELS, ORDER_STAGE_LABELS } from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { formatPickupWindow } from "@/lib/pickup-schedule";
import { formatQuantity, fromDecimalString } from "@/lib/quantity";
import { formatCalendarDate, formatLongDate, toDateKey } from "@/lib/time";
import type { OrderSummaryRecord } from "@/server/data/orders";

interface OrderSummaryProps {
  order: OrderSummaryRecord;
  displayNumber: string;
  timeZone: string;
}

// The order as created: number, customer, lines, total, stage, fulfilment.
export function OrderSummary({ order, displayNumber, timeZone }: OrderSummaryProps) {
  const services = order.lines.filter((line) => line.lineType === "SERVICE");
  const others = order.lines.filter((line) => line.lineType === "ADJUSTMENT");
  const version1 = order.quoteRevisions[0];
  const approved = order.approvedQuote !== null;
  const total = order.approvedQuote?.total ?? version1?.total ?? 0;
  const pickup = order.fulfilmentType === "PICKUP_DELIVERY";

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader
        title={`Order ${displayNumber}`}
        description={`Created ${formatLongDate(order.createdAt, timeZone)}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/orders/new">New order</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">{ORDER_STAGE_LABELS[order.stage]}</Badge>
        <Badge variant="neutral">{ORDER_CHANNEL_LABELS[order.channel]}</Badge>
        <Badge variant="neutral">{FULFILMENT_TYPE_LABELS[order.fulfilmentType]}</Badge>
        {order.isOutsideSchedule && <Badge variant="warning">Outside normal schedule</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-grid lg:grid-cols-2">
        <SummaryCard title="Customer">
          <Detail label="Name" value={order.customer.name} />
          <Detail label="Phone" value={formatPhone(order.customer.phone)} />
          {order.customer.email && <Detail label="Email" value={order.customer.email} />}
        </SummaryCard>

        <SummaryCard title="Fulfilment">
          <Detail label="Type" value={FULFILMENT_TYPE_LABELS[order.fulfilmentType]} />
          {pickup && (
            <>
              <Detail
                label="Area"
                value={
                  <span className="flex flex-wrap items-center gap-2">
                    {order.serviceAreaName ?? "—"}
                    {order.isOutOfArea && <Badge variant="warning">Outside service areas</Badge>}
                  </span>
                }
              />
              <Detail label="Address" value={order.addressText ?? "—"} />
              {order.scheduledPickupDate && (
                <Detail label="Pickup date" value={formatCalendarDate(toDateKey(order.scheduledPickupDate))} />
              )}
              {order.scheduledWindowStart && order.scheduledWindowEnd && (
                <Detail
                  label="Pickup window"
                  value={formatPickupWindow({ start: order.scheduledWindowStart, end: order.scheduledWindowEnd })}
                />
              )}
            </>
          )}
        </SummaryCard>
      </div>

      <SummaryCard title="Lines">
        <ul className="flex flex-col divide-y divide-border">
          {services.map((line) => {
            const quantity = line.quantity === null ? null : fromDecimalString(line.quantity.toString());
            const estimate =
              line.estimatedQuantity === null ? null : fromDecimalString(line.estimatedQuantity.toString());
            const pricingType = line.pricingType ?? "PER_ITEM";
            return (
              <LineRow
                key={line.id}
                label={line.description}
                detail={
                  quantity === null
                    ? `Not weighed yet${estimate === null ? "" : ` · customer's estimate ${formatQuantity(estimate, pricingType)}`}`
                    : `${formatQuantity(quantity, pricingType)} × ${formatNaira(line.unitPrice ?? 0)}`
                }
                amount={line.lineTotal === null ? "Weigh later" : formatNaira(line.lineTotal)}
              />
            );
          })}
          {others.map((line) => (
            <LineRow key={line.id} label={line.description} detail="Others" amount={formatNaira(line.lineTotal ?? 0)} />
          ))}
          {pickup && (
            <LineRow
              label="Pickup & delivery"
              amount={order.fulfilmentCharge === null ? "Quote pending" : formatNaira(order.fulfilmentCharge)}
            />
          )}
        </ul>
        <div className="flex items-baseline justify-between gap-component border-t border-border pt-component">
          <span className="type-label text-foreground">{approved ? "Agreed total" : "Estimated total"}</span>
          <span className="type-h3 text-foreground">{formatNaira(total)}</span>
        </div>
        {!approved && (
          <p className="type-caption text-muted-foreground">
            Some lines still need weighing. The priced quote comes after weighing.
          </p>
        )}
      </SummaryCard>

      {order.internalNote && (
        <SummaryCard title="Internal note">
          <p className="type-body-sm whitespace-pre-line text-foreground">{order.internalNote}</p>
          <p className="type-caption text-muted-foreground">Never shown to customers.</p>
        </SummaryCard>
      )}
    </main>
  );
}

function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="type-h3">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-component">{children}</CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="type-caption text-muted-foreground">{label}</span>
      <span className="type-body-sm break-words text-foreground">{value}</span>
    </div>
  );
}

function LineRow({ label, detail, amount }: { label: string; detail?: string; amount: string }) {
  return (
    <li className="flex items-start justify-between gap-component py-2.5 first:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="type-body-sm break-words text-foreground">{label}</span>
        {detail && <span className="type-caption text-muted-foreground">{detail}</span>}
      </div>
      <span className="type-body-sm shrink-0 text-foreground">{amount}</span>
    </li>
  );
}
