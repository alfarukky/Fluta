import Image from "next/image";

import { RECEIPT_TEXT } from "@/lib/receipts";
import type { Receipt as ReceiptData, ReceiptRow } from "@/types/receipts";

// The receipt itself, as customers read it. On screen it is a narrow card in
// the page's theme; printed, it is black on white whatever the theme (the
// `receipt` class in globals.css), at a receipt width that fits 58 mm and
// 80 mm paper and stays narrow on A4. Rows never split across pages, and long
// names wrap rather than being cut off.
export function Receipt({ receipt }: { receipt: ReceiptData }) {
  const { store } = receipt;
  return (
    <article
      aria-label="Receipt"
      className="receipt mx-auto flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-card text-card-foreground"
    >
      <header className="flex flex-col items-center gap-1 text-center">
        {store.logoUrl && (
          <span className="relative size-14 shrink-0 overflow-hidden">
            {/* Loaded straight from R2's public domain, never through the app. */}
            <Image src={store.logoUrl} alt="" fill sizes="56px" unoptimized className="object-contain" />
          </span>
        )}
        <h1 className="type-h3 break-words">{store.name}</h1>
        {store.address && <p className="type-body-sm break-words">{store.address}</p>}
        {store.phone && <p className="type-body-sm">{store.phone}</p>}
      </header>

      {receipt.cancelledNote && (
        <p className="type-label receipt-row border-y border-border py-2 text-center">{receipt.cancelledNote}</p>
      )}

      <div className="type-body-sm flex flex-col gap-0.5">
        <p className="receipt-row">{receipt.orderNumber}</p>
        <p className="receipt-row">{receipt.date}</p>
        <p className="receipt-row break-words">{receipt.customer}</p>
        <p className="receipt-row">{receipt.phone}</p>
      </div>

      <section aria-label={RECEIPT_TEXT.items} className="flex flex-col gap-2">
        <h2 className="type-label">{RECEIPT_TEXT.items}</h2>
        <ul className="flex flex-col gap-1.5">
          {receipt.lines.map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </ul>
        {receipt.total && (
          <div className="receipt-row type-label flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <span>{receipt.total.label}</span>
            <span className="whitespace-nowrap text-right tabular-nums">{receipt.total.amount}</span>
          </div>
        )}
        {receipt.priceNote && <p className="receipt-row type-body-sm break-words">{receipt.priceNote}</p>}
      </section>

      <section aria-label={RECEIPT_TEXT.payments} className="flex flex-col gap-2">
        <h2 className="type-label">{RECEIPT_TEXT.payments}</h2>
        <ul className="flex flex-col gap-1.5">
          {receipt.payments.map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </ul>
      </section>

      {receipt.balance && <p className="receipt-row type-label border-t border-border pt-2">{receipt.balance}</p>}
    </article>
  );
}

function Row({ row }: { row: ReceiptRow }) {
  return (
    <li className="receipt-row type-body-sm grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
      <span className="min-w-0 break-words">
        {row.label}
        {row.detail && <span className="block text-muted-foreground">{row.detail}</span>}
      </span>
      {row.amount && <span className="whitespace-nowrap text-right tabular-nums">{row.amount}</span>}
    </li>
  );
}
