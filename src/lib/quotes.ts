import type { ActorType, OrderStage } from "@/generated/prisma/enums";

import { formatNaira } from "./money";
import { isAwaitingApproval, type RevisionStatus } from "./orders";

// Quote and revision rules shared by the edit-quote screen (its live
// preview) and the server, which always checks them again.

// Revisions (and address changes) are possible up to Ready. From delivery
// onwards, anything that comes up is settled outside Fluta.
export const REVISABLE_STAGES = [
  "BOOKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "RECEIVED_BY_STORE",
  "QUOTE_AWAITING_APPROVAL",
  "IN_PROGRESS",
  "READY",
] as const satisfies readonly OrderStage[];

export function canReviseQuote(stage: OrderStage): boolean {
  return (REVISABLE_STAGES as readonly OrderStage[]).includes(stage);
}

export const REVISION_REASON_MAX = 300;

// A reason (shown to the customer) is required for every revision after the
// order's first approved quote; it is optional for the first priced quote.
export function isRevisionReasonRequired(hasApprovedQuote: boolean): boolean {
  return hasApprovedQuote;
}

// The new total minus the last approved one; null when nothing is approved yet.
export function getTotalDifference(approvedTotal: number | null, newTotal: number): number | null {
  return approvedTotal === null ? null : newTotal - approvedTotal;
}

// "+₦2,500", "−₦500", or "No change".
export function formatDifference(kobo: number): string {
  if (kobo === 0) return "No change";
  return kobo > 0 ? `+${formatNaira(kobo)}` : formatNaira(kobo);
}

export interface RevisionSummary extends RevisionStatus {
  id: string;
}

// The revision waiting for the customer's approval, if any (at most one).
export function findPendingRevision<T extends RevisionSummary>(revisions: readonly T[]): T | null {
  return revisions.find(isAwaitingApproval) ?? null;
}

// The newest revision, when the customer declined it and nothing has been
// issued since: staff then issue a new revision or cancel.
export function findDeclinedRevision<T extends RevisionSummary>(revisions: readonly T[]): T | null {
  const latest = revisions.reduce<T | null>((newest, revision) => (!newest || revision.version > newest.version ? revision : newest), null);
  return latest?.status === "DECLINED" ? latest : null;
}

export interface RevisionMoment {
  moment: "ISSUED" | "APPROVED" | "DECLINED";
  version: number;
  total: number;
  difference: number | null;
  customerMessage: string | null;
  decidedBy: ActorType | null;
}

// A revision entry in the order's timeline:
// "Quote v2 issued: ₦12,500 (+₦2,500)", "Quote v2 approved by customer
// (recorded by Ada)", "Quote v3 declined: Too expensive".
export function describeRevisionMoment(entry: RevisionMoment, staffName: string | null): string {
  const quote = `Quote v${entry.version}`;
  const recorded = entry.decidedBy === "STAFF" ? ` (recorded by ${staffName ?? "staff"})` : "";
  switch (entry.moment) {
    case "ISSUED": {
      const difference = entry.difference === null ? "" : ` (${formatDifference(entry.difference)})`;
      return `${quote} issued: ${formatNaira(entry.total)}${difference}`;
    }
    case "APPROVED":
      return `${quote} approved by customer${recorded}`;
    case "DECLINED":
      return `${quote} declined${entry.customerMessage ? `: ${entry.customerMessage}` : ""}${recorded}`;
  }
}
