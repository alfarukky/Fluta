import "server-only";

import type {
  FulfilmentType,
  OrderChannel,
  OrderStage,
  PaymentMethod,
  PaymentStatus,
  QuoteStatus,
} from "@/generated/prisma/enums";
import { formatOrderNumber, isAwaitingApproval } from "@/lib/orders";
import { formatNaira } from "@/lib/money";
import { maskPhone, formatPhone } from "@/lib/phone";
import { fromStoredQuantity } from "@/lib/quantity";
import {
  RECEIPT_TEXT,
  describeReceiptBalance,
  describeReceiptPayment,
  describeReceiptRefund,
  formatReceiptDateTime,
  formatReceiptDate,
  formatSignedReceiptAmount,
  receiptCustomer,
  receiptDate,
  receiptOrderNumber,
  receiptPhone,
} from "@/lib/receipts";
import type { Receipt, ReceiptRow } from "@/types/receipts";

import { getBalance } from "./balance";
import type { QuoteSnapshot } from "./orders";

// An order-level receipt: the confirmed payments (and refunds) recorded
// against the order, with the approved price. It uses the same records and
// rules as getBalance, so it can never disagree with the order page.

type StoredQuantity = { toString(): string } | null;

export interface ReceiptOrder {
  orderNumber: number;
  stage: OrderStage;
  channel: OrderChannel;
  payLater: boolean;
  fulfilmentType: FulfilmentType;
  createdAt: Date;
  store: {
    name: string;
    addressText: string | null;
    phone: string | null;
    timeZone: string;
    orderPrefix: string;
  };
  customer: { name: string; phone: string };
  // The order's own service lines: names and quantities only, never prices.
  lines: readonly {
    id: string;
    description: string;
    quantity: StoredQuantity;
    estimatedQuantity: StoredQuantity;
  }[];
  approvedQuote: {
    total: number;
    fulfilmentCharge: number;
    linesSnapshot: unknown;
  } | null;
  quoteRevisions: readonly {
    version: number;
    status: QuoteStatus;
    approvedAt: Date | null;
    declinedAt: Date | null;
  }[];
  payments: readonly {
    id: string;
    amount: number;
    method: PaymentMethod;
    status: PaymentStatus;
    voidedAt: Date | null;
    confirmedAt: Date | null;
    createdAt: Date;
  }[];
  refunds: readonly {
    id: string;
    amount: number;
    method: PaymentMethod;
    voidedAt: Date | null;
    paidAt: Date;
  }[];
}

export function buildReceipt(order: ReceiptOrder, logoUrl: string | null): Receipt {
  const timeZone = order.store.timeZone;
  const balance = getBalance(order);
  const cancelled = order.stage === "CANCELLED";
  const approved = order.approvedQuote;
  const pendingUpdate = !cancelled && order.stage !== "COMPLETED" && order.quoteRevisions.some(isAwaitingApproval);

  return {
    store: {
      name: order.store.name,
      logoUrl,
      address: order.store.addressText,
      phone: order.store.phone ? formatPhone(order.store.phone) : null,
    },
    cancelledNote: cancelled ? RECEIPT_TEXT.cancelled : null,
    orderNumber: receiptOrderNumber(formatOrderNumber(order.store, order.orderNumber)),
    date: receiptDate(formatReceiptDateTime(order.createdAt, timeZone)),
    customer: receiptCustomer(order.customer.name),
    phone: receiptPhone(maskPhone(order.customer.phone)),
    lines: approved ? approvedRows(order, approved) : unpricedRows(order),
    // Always the approved revision's own total, never added up from the rows.
    total: approved
      ? {
          key: "total",
          label: RECEIPT_TEXT.total,
          detail: null,
          amount: formatNaira(approved.total),
        }
      : null,
    priceNote: approved
      ? pendingUpdate
        ? RECEIPT_TEXT.pendingPriceUpdate
        : null
      : cancelled
        ? null
        : RECEIPT_TEXT.priceToBeConfirmed,
    payments: paymentRows(order, timeZone),
    // A cancelled order owes nothing, so its position is always known.
    balance: approved || cancelled ? describeReceiptBalance(balance) : null,
  };
}

// The approved revision's lines copy: service lines as quantity × unit price
// and line total, extra charges and discounts with their stored sign, then
// the pickup and delivery charge.
function approvedRows(order: ReceiptOrder, approved: NonNullable<ReceiptOrder["approvedQuote"]>): ReceiptRow[] {
  const snapshot = approved.linesSnapshot as QuoteSnapshot;
  const rows = snapshot.lines.map((line, index): ReceiptRow => {
    if (line.lineType === "ADJUSTMENT") {
      return {
        key: `line-${index}`,
        label: line.description,
        detail: null,
        amount: formatSignedReceiptAmount(line.lineTotal),
      };
    }
    const quantity = line.quantity === null ? null : fromStoredQuantity(line.quantity);
    return {
      key: `line-${index}`,
      label: line.description,
      detail: quantity === null ? null : `${quantity} × ${formatNaira(line.unitPrice ?? 0)}`,
      amount: formatNaira(line.lineTotal),
    };
  });
  // Pickup orders always show the charge ("Free" at ₦0); drop-off orders have no pickup line.
  if (order.fulfilmentType === "PICKUP_DELIVERY") {
    rows.push({
      key: "pickup",
      label: RECEIPT_TEXT.pickupCharge,
      detail: null,
      amount: approved.fulfilmentCharge === 0 ? RECEIPT_TEXT.free : formatNaira(approved.fulfilmentCharge),
    });
  }
  return rows;
}

// Nothing approved yet: names and quantities only, never a price.
function unpricedRows(order: ReceiptOrder): ReceiptRow[] {
  return order.lines.map((line): ReceiptRow => {
    const quantity = line.quantity ?? line.estimatedQuantity;
    return {
      key: line.id,
      label: line.description,
      detail: quantity === null ? null : `× ${fromStoredQuantity(quantity.toString())}`,
      amount: null,
    };
  });
}

// Active payments and active refunds, in date order. Voided records and
// pending or failed online attempts never appear.
function paymentRows(order: ReceiptOrder, timeZone: string): ReceiptRow[] {
  const payments = order.payments
    .filter((payment) => payment.status === "CONFIRMED" && payment.voidedAt === null)
    .map((payment) => ({
      key: `payment-${payment.id}`,
      at: payment.confirmedAt ?? payment.createdAt,
      label: (day: string) => describeReceiptPayment(payment.method, day),
      amount: formatNaira(payment.amount),
    }));
  const refunds = order.refunds
    .filter((refund) => refund.voidedAt === null)
    .map((refund) => ({
      key: `refund-${refund.id}`,
      at: refund.paidAt,
      label: (day: string) => describeReceiptRefund(refund.method, day),
      amount: formatNaira(refund.amount),
    }));
  return [...payments, ...refunds]
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key))
    .map((entry) => ({
      key: entry.key,
      label: entry.label(formatReceiptDate(entry.at, timeZone)),
      detail: null,
      amount: entry.amount,
    }));
}
