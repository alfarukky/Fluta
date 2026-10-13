import "server-only";

import type { ActorType, OrderStage, QuoteStatus } from "@/generated/prisma/client";

import { AUDIT_ACTIONS } from "./quotes";

// One timeline for an order: stage events and revision moments (issued,
// approved, declined), newest first. The page shows it as it comes; it never
// merges lists itself.

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

export type TimelineEntry =
  | { kind: "stage"; key: string; at: Date; event: TimelineStageEvent }
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
  if (entry.kind === "stage") return 2;
  return entry.moment === "ISSUED" ? 0 : 1;
}

export function buildOrderTimeline(
  events: readonly TimelineStageEvent[],
  revisions: readonly TimelineRevision[],
  audits: readonly TimelineAudit[],
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
