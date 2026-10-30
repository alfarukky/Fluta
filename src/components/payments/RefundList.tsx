"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { loadMoreRefunds } from "@/actions/refunds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrderPath } from "@/lib/order-links";
import { PAYMENT_METHOD_LABELS } from "@/lib/orders";
import { cn } from "@/lib/utils";
import type { PaymentListFilters } from "@/schemas/payments";
import type { RefundListRow } from "@/types/refunds";

interface RefundListProps {
  filters: PaymentListFilters;
  initialRows: RefundListRow[];
  initialCursor: string | null;
}

// The store's refunds, voided ones crossed out: a table on desktop, stacked
// cards below. More rows load when "Load more" scrolls into view, or when it
// is tapped.
export function RefundList({ filters, initialRows, initialCursor }: RefundListProps) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  function loadMore() {
    if (!cursor || pending) return;
    startTransition(async () => {
      const result = await loadMoreRefunds(filters, cursor);
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
    <section aria-label="Refunds" className="flex flex-col gap-component">
      <ul className="flex flex-col gap-component lg:hidden">
        {rows.map((row) => (
          <RefundCard key={row.id} row={row} />
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card lg:block">
        <RefundTable rows={rows} />
      </div>

      {cursor && (
        <Button ref={loadMoreRef} variant="outline" onClick={loadMore} disabled={pending} className="self-center">
          {pending ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}

function StatusBadge({ row }: { row: RefundListRow }) {
  if (row.voided) return <Badge variant="neutral">Voided</Badge>;
  return <Badge variant="info">{row.correction ? "Paid · Correction" : "Paid"}</Badge>;
}

function RefundTable({ rows }: { rows: RefundListRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-card">Paid back</TableHead>
          <TableHead>Order</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Recorded by</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="pr-card text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="relative">
            <TableCell className={cn("type-body-sm pl-card align-top whitespace-normal", row.voided && "line-through")}>
              {row.paid}
            </TableCell>
            <TableCell className="min-w-40 align-top whitespace-normal">
              <div className="flex min-w-0 flex-col">
                {/* The link covers the whole row, so any part of it opens the order. */}
                <Link
                  href={getOrderPath(row.orderId)}
                  className="type-label text-foreground outline-none after:absolute after:inset-0 focus-visible:underline"
                >
                  {row.displayNumber}
                </Link>
                <span className="type-body-sm wrap-break-word text-muted-foreground">{row.customerName}</span>
              </div>
            </TableCell>
            <TableCell className="type-body-sm align-top whitespace-normal">{PAYMENT_METHOD_LABELS[row.method]}</TableCell>
            <TableCell className="type-body-sm align-top wrap-break-word whitespace-normal">{row.recordedBy}</TableCell>
            <TableCell className="align-top whitespace-normal">
              <StatusBadge row={row} />
            </TableCell>
            <TableCell className={cn("type-label pr-card text-right align-top", row.voided && "line-through")}>
              {row.amount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RefundCard({ row }: { row: RefundListRow }) {
  return (
    <li className="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <Link
            href={getOrderPath(row.orderId)}
            className="type-h3 text-foreground outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            {row.displayNumber}
          </Link>
          <span className="type-body-sm wrap-break-word text-foreground">{row.customerName}</span>
          <span className={cn("type-caption text-muted-foreground", row.voided && "line-through")}>{row.paid}</span>
        </div>
        <span className={cn("type-label shrink-0 text-right text-foreground", row.voided && "line-through")}>
          {row.amount}
        </span>
      </div>
      <p className="type-body-sm wrap-break-word text-muted-foreground">
        {PAYMENT_METHOD_LABELS[row.method]} · {row.recordedBy}
      </p>
      <div>
        <StatusBadge row={row} />
      </div>
    </li>
  );
}
