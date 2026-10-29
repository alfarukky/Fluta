# Feature 19 — Receipts (staff only)

## Overview

Owners and staff can open a printable receipt for any order that has been paid for, fully or in part, to print at the counter or save and share when a customer asks. Customers don't have a receipt page in Fluta. They ask the store.

**What the receipt is:** an **order-level** receipt that records the confirmed payments (and any refunds) against an order. There is one per order, numbered by the order number. It doesn't mean the order is fully paid: the balance line says where things stand.

## Requirements

### When a receipt is available

- **Only after at least one active confirmed payment:** a payment with status confirmed that isn't voided. Pending or failed online attempts never count, including Paystack ones until they are confirmed
- **Refunds alone never make a receipt available**
- With no active confirmed payment, the page shows "A receipt will be available once a payment is recorded", with the order number only
- This applies to a saved or bookmarked receipt link too: if the only payment has since been voided, the page shows that message, never the old receipt

### Opening it

- "Print receipt" among the order detail page's secondary actions, opening `/orders/[id]/receipt`. It appears only once the order has an active confirmed payment
- Owners and staff only (`requireStoreMember()`), checked on the page itself, not just by hiding the button. Riders are refused. The store comes from the membership, and another store's order returns "Order not found"

### One function prepares the receipt

- One server function (for example `getReceiptData`) does all the work, and the page only displays what it returns:
  1. checks access and the store
  2. checks there is an active confirmed payment
  3. reads the approved revision, the active payments, and the active refunds
  4. calls `getBalance` for the balance
  5. masks the customer's phone through `phone.ts`
  6. returns only the fields the receipt shows
- It uses the same records and rules as `getBalance`, so the receipt can never disagree with the order page

### Where the figures come from

- **Store details are current:** name, logo, address, and phone from the store's settings
- **Money figures always come from the permanent records:** the approved revision, payments, and refunds. Never from today's catalogue, and never from the order's working lines
- **The total is always the approved revision's total**, never added up from the lines shown
- **Lines** come from the approved revision's lines copy: service lines as name, quantity × unit price, and line total (for example "Duvet  2 × ₦5,000  ₦10,000"). Others lines show their description and their stored signed amount exactly ("Discount  −₦500"). Then, on pickup orders, the pickup and delivery charge ("Pickup and delivery: Free" when it is ₦0). Drop-off orders have no pickup line
- **A price update waiting for approval** is never included in any figure. The receipt uses the approved revision, with the note in the plain wording below
- **A cancelled order** keeps its approved total on the receipt, with "This order was cancelled" at the top. The current position is shown by the balance line from `getBalance`

### What the receipt shows

- **Store:** logo (if any), name, address, and phone
- **Order:** the order number and the date and time it was created (12-hour, store time zone)
- **Customer:** their name, and the phone **masked**, because a receipt leaves the store
- **Lines and total,** as above
- **Payments:** one list in date order, of active payments and active refunds only, for example:
  - "Paid in cash, 30 Oct 2026  ₦10,000"
  - "Refunded by bank transfer, 1 Nov 2026  ₦10,000"
- **Balance**, from `getBalance`, in the plain wording below: "Fully paid", "Amount still to pay: ₦X", "Amount to be refunded to you: ₦X", or "Nothing to pay"

It never shows voided records, pending or failed online attempts, Fluta's or Paystack's fees, staff names, notes, references, the full phone, or any address of the customer's.

### Plain wording (anyone must understand it)

The receipt is read by customers, not staff, so every word on it is plain everyday English. No internal terms (never "revision", "adjustment", "Others", "balance state", "source", or codes), no abbreviations except ₦, and nothing a customer would need explained.

| On the receipt | Exact wording |
| --- | --- |
| Order number | "Order number: FF-1024" |
| Date | "Date: 30 Oct 2026, 10:42 AM" |
| Customer | "Customer: Aisha Bello" and "Phone: +234 803 *** 4521" |
| Items heading | "Items" |
| An extra charge or discount | its own description, for example "Express service  +₦2,000" or "Discount  −₦500" |
| Pickup charge | "Pickup and delivery", or "Pickup and delivery: Free" when it is ₦0 (pickup orders only) |
| Total | "Total" |
| Payment history heading | "Payments" |
| A payment | "Paid in cash", "Paid by bank transfer", "Paid by card (POS)", "Paid online", or "Paid (other)", with the date |
| A refund | "Refunded in cash", "Refunded by bank transfer", "Refunded by card (POS)", or "Refunded (other)", with the date |
| Fully paid | "Fully paid" |
| Part paid | "Amount still to pay: ₦X" |
| Refund owed | "Amount to be refunded to you: ₦X" |
| Nothing due (cancelled) | "Nothing to pay" |
| Cancelled order | "This order was cancelled" |
| A price update waiting for approval | "The store has proposed a new price you haven't approved yet. This receipt shows the price you agreed." |
| A deposit before the price is approved | "Final price to be confirmed by the store" |

- Amounts use the shared `formatNaira`: ₦ with commas (₦10,000), and kobo only when an amount has some (₦1,500.50). Every line and the total come from the stored amounts, so they always add up
- The order date shows the day, a short month, the year, and the 12-hour time ("30 Oct 2026, 10:42 AM"). Payment and refund dates show the day, a short month, and the year ("30 Oct 2026")

**Example of a part-paid receipt:**

```text
FreshFold Laundry
12 Admiralty Way, Lekki · 0803 000 1234

Order number: FF-1024
Date: 30 Oct 2026, 10:42 AM
Customer: Aisha Bello
Phone: +234 803 *** 4521

Items
Shirt             4 × ₦800        ₦3,200
Duvet             2 × ₦5,000     ₦10,000
Discount                            −₦500
Pickup and delivery                ₦1,500
─────────────────────────────────────────
Total                             ₦14,200

Payments
Paid in cash, 30 Oct 2026          ₦5,000

Amount still to pay: ₦9,200
```

### A deposit paid before the price is approved

- The receipt shows the items as **names and quantities only**, with "Final price to be confirmed by the store", then the payments
- **No prices, line totals, total, or balance figure** are shown, because nothing is approved yet. Never take a price or total from the order's working lines

### Printing

- A **Print** button using the browser's own print function. No PDFs are generated, and no printer integrations. The browser's "Save as PDF" lets staff save a copy to share
- A print layout with a narrow receipt width that adapts to 58 mm and 80 mm thermal paper, and to A4 (where the receipt keeps its narrow width rather than filling the page)
- Only the receipt prints: no navigation, buttons, or banners. Black on white whatever the screen theme, amounts aligned right
- Rows never split across pages, and **long item names and descriptions wrap** rather than being cut off. Because printers and their settings vary, the measure is: nothing Fluta controls is clipped or split

## Not in this feature

- A receipt page for customers, or a "View receipt" link on the tracking page
- Emailing receipts from Fluta
- PDF files or printer integrations
- Separate receipts per payment

## Done when

- Unit tests for the receipt data:
  - lines, Others lines with their stored sign, the pickup charge, the total taken from the approved revision, payment history in date order, and the balance wording
  - no receipt without an active confirmed payment, none when the only payment is voided or still pending, and none from refunds alone
  - a part-paid receipt shows the balance due
  - a deposit before approval shows names and quantities only, with no prices or totals
  - a pending price update never changes any figure
  - a cancelled order keeps its approved total, with the balance from `getBalance`
  - it never includes voided records, pending attempts, fees, references, notes, staff names, the full phone, or an address
  - every label and message matches the plain wording table exactly, and no internal term ("revision", "adjustment", "Others", codes) ever appears
- Integration tests:
  - owners and staff can open a receipt, riders are refused by the page itself, and a FreshFold user can't open a CleanWave receipt, even by sending its ID
  - a receipt link for an order whose only payment was later voided shows "A receipt will be available once a payment is recorded"
  - the receipt's balance always matches the order page's for the same order
- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` all pass

## Verify with

- **Playwright MCP**, at ~360px and desktop, light and dark:
  - an unpaid order (no receipt), a paid, a part-paid, a refunded, a cancelled, and a deposit-only order
  - print preview at 58 mm, 80 mm, and A4, including an order with a very long item name and a long Others description: nothing clipped, no row split across pages
- **Next.js DevTools:** no runtime or build errors on `/orders/[id]/receipt`

## References

- @context/project-overview.md (Receipts, Payment states)
- @context/features/10-orders-list-and-detail-spec.md (`getBalance`)
- @context/features/12-quotes-and-revisions-spec.md (approved revisions)
- @context/features/16-store-collected-payments-spec.md and @context/features/18-refunds-spec.md
