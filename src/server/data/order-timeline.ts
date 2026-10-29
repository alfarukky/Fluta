import "server-only";

import type {
  ActorType,
  OrderStage,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
  QuoteStatus,
} from "@/generated/prisma/client";

import { AUDIT_ACTIONS } from "./quotes";

// One timeline for an order: stage events, revision moments (issued,
// approved, declined), pickup times the store suggested, and payments
// and refunds recorded or voided, newest first. Payments and refunds are
// their own entries, never status events.
// The page shows it as it comes; it never merges lists itself. Staff only:
// the tracking page has its own customer timeline (src/lib/tracking.ts).

export interface TimelineStageEvent {
  id: string;
  fromStage: OrderStage | null;
  toStage: OrderStage;
  actorType: ActorType;
  actorUserId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface TimelineRevision {
  id: string;
  version: number;
  status: QuoteStatus;
  total: number;
  reason: string | null;
  customerMessage: string | null;
  createdAt: Date;
  createdByUserId: string | null;
  approvedAt: Date | null;
  approvedByActor: ActorType | null;
  declinedAt: Date | null;
}

export interface TimelineAudit {
  action: string;
  actorUserId: string | null;
  targetId: string | null;
}

// A pickup time staff suggested to the customer (its AuditEvent).
export interface TimelinePickupSuggestion {
  id: string;
  actorUserId: string | null;
  createdAt: Date;
  date: string; // "YYYY-MM-DD"
  windowStart: string;
  windowEnd: string;
  isOutsideSchedule: boolean;
  note: string | null;
}

// A pickup order stepped back to Booked: its time went back to the customer's
// request. The date and window are the scheduled time that was cleared.
export interface TimelinePickupReset {
  id: string;
  actorUserId: string | null;
  createdAt: Date;
  date: string | null; // "YYYY-MM-DD"
  windowStart: string | null;
  windowEnd: string | null;
  isOutsideSchedule: boolean;
}

// A payment as the timeline needs it. Pending and failed attempts have no
// confirmation time and never appear.
export interface TimelinePayment {
  id: string;
  amount: number;
  method: PaymentMethod;
  source: PaymentSource;
  status: PaymentStatus;
  recordedByUserId: string | null;
  confirmedAt: Date | null;
  voidedAt: Date | null;
  voidedByUserId: string | null;
  // Staff only: never shown on the tracking page or in customer messages.
  voidReason: string | null;
  // Online only: money that arrived when nothing was due (plan 6.9).
  receivedAfter?: "CANCELLED" | "PAID" | null;
}

// A refund as the timeline needs it: money the store paid back outside Fluta.
export interface TimelineRefund {
  id: string;
  amount: number;
  method: PaymentMethod;
  recordedByUserId: string;
  paidAt: Date;
  voidedAt: Date | null;
  voidedByUserId: string | null;
  // Staff only: never shown on the tracking page or in customer messages.
  voidReason: string | null;
}

export type TimelineEntry =
  | { kind: "stage"; key: string; at: Date; event: TimelineStageEvent }
  | {
      kind: "refund";
      key: string;
      at: Date;
      moment: "RECORDED" | "VOIDED";
      refund: TimelineRefund;
      // Who recorded it, or who voided it.
      staffUserId: string | null;
    }
  | {
      kind: "payment";
      key: string;
      at: Date;
      moment: "RECORDED" | "VOIDED";
      payment: TimelinePayment;
      // Who recorded it, or who voided it.
      staffUserId: string | null;
    }
  | { kind: "pickupSuggested"; key: string; at: Date; suggestion: TimelinePickupSuggestion }
  | { kind: "pickupReset"; key: string; at: Date; reset: TimelinePickupReset }
  | {
      kind: "revision";
      key: string;
      at: Date;
      moment: "ISSUED" | "APPROVED" | "DECLINED";
      version: number;
      total: number;
      // New total minus the total approved when it was issued; null for the first priced quote.
      difference: number | null;
      reason: string | null;
      customerMessage: string | null;
      // Who approved or declined: the customer (through their link) or staff
      // recording what the customer said.
      decidedBy: ActorType | null;
      // The staff member who issued it, or recorded the decision.
      staffUserId: string | null;
    };

// Within the same moment: a revision is issued before the stage moves, and
// approved before the order returns from Quote awaiting approval.
function rank(entry: TimelineEntry): number {
  // A correct payment or refund recorded in place of a voided one follows the void.
  if (entry.kind === "payment" || entry.kind === "refund") return entry.moment === "RECORDED" ? 5 : 4;
  // A pickup time reset is written with the step back that caused it, and
  // follows it.
  if (entry.kind === "pickupReset") return 3;
  if (entry.kind === "stage") return 2;
  if (entry.kind === "pickupSuggested") return 1;
  return entry.moment === "ISSUED" ? 0 : 1;
}

export function buildOrderTimeline(
  events: readonly TimelineStageEvent[],
  revisions: readonly TimelineRevision[],
  audits: readonly TimelineAudit[],
  pickupSuggestions: readonly TimelinePickupSuggestion[] = [],
  pickupResets: readonly TimelinePickupReset[] = [],
  payments: readonly TimelinePayment[] = [],
  refunds: readonly TimelineRefund[] = [],
): TimelineEntry[] {
  const recorder = new Map<string, string | null>();
  for (const audit of audits) {
    if (!audit.targetId) continue;
    if (audit.action === AUDIT_ACTIONS.approvalRecorded || audit.action === AUDIT_ACTIONS.declineRecorded) {
      recorder.set(`${audit.action}:${audit.targetId}`, audit.actorUserId);
    }
  }

  const entries: TimelineEntry[] = events.map((event) => ({
    kind: "stage",
    key: `stage-${event.id}`,
    at: event.createdAt,
    event,
  }));

  for (const revision of revisions) {
    // Version 1 is the order's own quote, agreed (or estimated) when the
    // order was created: the first stage entry already covers that moment.
    const atCreation = (at: Date | null) => revision.version === 1 && at?.getTime() === revision.createdAt.getTime();
    const base = {
      kind: "revision" as const,
      version: revision.version,
      total: revision.total,
      reason: revision.reason,
      customerMessage: revision.customerMessage,
    };

    if (revision.version > 1) {
      entries.push({
        ...base,
        key: `issued-${revision.id}`,
        at: revision.createdAt,
        moment: "ISSUED",
        difference: differenceAtIssue(revision, revisions),
        decidedBy: null,
        staffUserId: revision.createdByUserId,
      });
    }
    if (revision.approvedAt && !atCreation(revision.approvedAt)) {
      entries.push({
        ...base,
        key: `approved-${revision.id}`,
        at: revision.approvedAt,
        moment: "APPROVED",
        difference: null,
        decidedBy: revision.approvedByActor,
        staffUserId: recorder.get(`${AUDIT_ACTIONS.approvalRecorded}:${revision.id}`) ?? null,
      });
    }
    if (revision.declinedAt && !atCreation(revision.declinedAt)) {
      const staffUserId = recorder.get(`${AUDIT_ACTIONS.declineRecorded}:${revision.id}`) ?? null;
      entries.push({
        ...base,
        key: `declined-${revision.id}`,
        at: revision.declinedAt,
        moment: "DECLINED",
        difference: null,
        decidedBy: staffUserId ? "STAFF" : "CUSTOMER",
        staffUserId,
      });
    }
  }

  for (const suggestion of pickupSuggestions) {
    entries.push({ kind: "pickupSuggested", key: `pickup-${suggestion.id}`, at: suggestion.createdAt, suggestion });
  }
  for (const reset of pickupResets) {
    entries.push({ kind: "pickupReset", key: `pickup-reset-${reset.id}`, at: reset.createdAt, reset });
  }

  for (const payment of payments) {
    if (!payment.confirmedAt || (payment.status !== "CONFIRMED" && payment.status !== "VOIDED")) continue;
    entries.push({
      kind: "payment",
      key: `payment-${payment.id}`,
      at: payment.confirmedAt,
      moment: "RECORDED",
      payment,
      staffUserId: payment.recordedByUserId,
    });
    if (payment.status === "VOIDED" && payment.voidedAt) {
      entries.push({
        kind: "payment",
        key: `payment-void-${payment.id}`,
        at: payment.voidedAt,
        moment: "VOIDED",
        payment,
        staffUserId: payment.voidedByUserId,
      });
    }
  }

  for (const refund of refunds) {
    entries.push({
      kind: "refund",
      key: `refund-${refund.id}`,
      at: refund.paidAt,
      moment: "RECORDED",
      refund,
      staffUserId: refund.recordedByUserId,
    });
    if (refund.voidedAt) {
      entries.push({
        kind: "refund",
        key: `refund-void-${refund.id}`,
        at: refund.voidedAt,
        moment: "VOIDED",
        refund,
        staffUserId: refund.voidedByUserId,
      });
    }
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime() || rank(b) - rank(a) || b.key.localeCompare(a.key));
}

// The total approved at the moment the revision was issued: the latest
// revision approved by then.
function differenceAtIssue(revision: TimelineRevision, revisions: readonly TimelineRevision[]): number | null {
  const approvedBefore = revisions
    .filter((other) => other.approvedAt !== null && other.approvedAt.getTime() <= revision.createdAt.getTime())
    .sort((a, b) => (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0))[0];
  return approvedBefore ? revision.total - approvedBefore.total : null;
}
