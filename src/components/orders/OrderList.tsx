"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { loadMoreOrders } from "@/actions/orders";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrderPath } from "@/lib/order-links";
import { FULFILMENT_TYPE_LABELS } from "@/lib/orders";
import type { OrderListFilters } from "@/schemas/orders";
import type { OrderListRow } from "@/types/orders";

import { OutOfAreaBadge, PaymentBadge, StageBadge } from "./OrderBadges";

interface OrderListProps {
  filters: OrderListFilters;
  initialRows: OrderListRow[];
  initialCursor: string | null;
}

// The orders list: a table from md up, stacked cards below. More rows load
// when the "Load more" button scrolls into view, or when it is tapped.
export function OrderList({ filters, initialRows, initialCursor }: OrderListProps) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  function loadMore() {
    if (!cursor || pending) return;
    startTransition(async () => {
      const result = await loadMoreOrders(filters, cursor);
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
    <section aria-label="Orders" className="flex flex-col gap-component">
      <ul className="flex flex-col gap-component md:hidden">
        {rows.map((row) => (
          <OrderCard key={row.id} row={row} />
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <OrderTable rows={rows} />
      </div>

      {cursor && (
        <Button ref={loadMoreRef} variant="outline" onClick={loadMore} disabled={pending} className="self-center">
          {pending ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}

function OrderTable({ rows }: { rows: OrderListRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-card">Order</TableHead>
          <TableHead>Services</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead className="pr-card text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="relative">
            <TableCell className="min-w-36 pl-card align-top whitespace-normal">
              <div className="flex min-w-0 flex-col">
                {/* The link covers the whole row, so any part of it opens the order. */}
                <Link
                  href={getOrderPath(row.id)}
                  className="type-label text-foreground outline-none after:absolute after:inset-0 focus-visible:underline"
                >
                  {row.displayNumber}
                </Link>
                <span className="type-body-sm wrap-break-word text-foreground">{row.customerName}</span>
                <span className="type-caption text-muted-foreground">{row.created}</span>
              </div>
            </TableCell>
            <TableCell className="min-w-40 align-top whitespace-normal">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-body-sm wrap-break-word text-foreground">{row.services || "—"}</span>
                <span className="type-caption text-muted-foreground">{FULFILMENT_TYPE_LABELS[row.fulfilmentType]}</span>
                {row.pickup && <span className="type-caption text-muted-foreground">Pickup {row.pickup}</span>}
                {row.isOutOfArea && (
                  <span className="mt-1">
                    <OutOfAreaBadge />
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <StageBadge stage={row.stage} />
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <PaymentBadge state={row.paymentState} />
            </TableCell>
            <TableCell className="type-label pr-card text-right align-top whitespace-normal">
              {row.total ?? <NoTotal row={row} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function OrderCard({ row }: { row: OrderListRow }) {
  return (
    <li className="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <Link
            href={getOrderPath(row.id)}
            className="type-h3 text-foreground outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            {row.displayNumber}
          </Link>
          <span className="type-body-sm wrap-break-word text-foreground">{row.customerName}</span>
          <span className="type-caption text-muted-foreground">{row.created}</span>
        </div>
        <span className="type-label shrink-0 text-right text-foreground">
          {row.total ?? <NoTotal row={row} />}
        </span>
      </div>
      {row.services && <p className="type-body-sm wrap-break-word text-muted-foreground">{row.services}</p>}
      {row.pickup && <p className="type-caption text-muted-foreground">Pickup {row.pickup}</p>}
      <div className="flex flex-wrap gap-2">
        <StageBadge stage={row.stage} />
        <PaymentBadge state={row.paymentState} />
        {row.isOutOfArea && <OutOfAreaBadge />}
      </div>
    </li>
  );
}

// An order without an approved quote: still awaiting one, or cancelled
// before it was ever priced (its payment state is then Nothing due).
function NoTotal({ row }: { row: OrderListRow }) {
  return (
    <span className="type-body-sm text-muted-foreground">
      {row.stage === "CANCELLED" ? "Not priced" : "Awaiting quote"}
    </span>
  );
}
