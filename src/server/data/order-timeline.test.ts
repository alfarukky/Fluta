import { describe, expect, it } from "vitest";

import { buildOrderTimeline, type TimelineEntry, type TimelineRevision, type TimelineStageEvent } from "./order-timeline";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 9, minute));

const stage = (id: string, minute: number, fromStage: TimelineStageEvent["fromStage"], toStage: TimelineStageEvent["toStage"]): TimelineStageEvent => ({
  id,
  fromStage,
  toStage,
  actorType: toStage === "QUOTE_AWAITING_APPROVAL" || fromStage === "QUOTE_AWAITING_APPROVAL" ? "SYSTEM" : "STAFF",
  actorUserId: null,
  note: null,
  createdAt: at(minute),
});

const revision = (overrides: Partial<TimelineRevision> & Pick<TimelineRevision, "id" | "version" | "total">): TimelineRevision => ({
  status: "SUPERSEDED",
  reason: null,
  customerMessage: null,
  createdAt: at(0),
  createdByUserId: "ada",
  approvedAt: null,
  approvedByActor: null,
  declinedAt: null,
  ...overrides,
});

describe("buildOrderTimeline", () => {
  const revisions = [
    // Priced at creation and agreed there and then: no entries of its own.
    revision({ id: "r1", version: 1, total: 1_000_000, approvedAt: at(0), approvedByActor: "STAFF" }),
    revision({ id: "r2", version: 2, total: 1_250_000, reason: "Actual weight 4.2 kg", createdAt: at(10), approvedAt: at(20), approvedByActor: "STAFF" }),
    revision({ id: "r3", version: 3, status: "DECLINED", total: 1_400_000, reason: "Extra duvet", createdAt: at(30), declinedAt: at(40), customerMessage: "Too expensive" }),
  ];
  const events = [stage("e1", 0, null, "RECEIVED_BY_STORE"), stage("e2", 5, "RECEIVED_BY_STORE", "IN_PROGRESS")];
  const audits = [{ action: "QUOTE_APPROVAL_RECORDED", actorUserId: "kemi", targetId: "r2" }];

  const label = (entry: TimelineEntry) =>
    entry.kind === "stage"
      ? `stage ${entry.event.toStage}`
      : entry.kind === "pickupSuggested"
        ? `pickup ${entry.suggestion.date} ${entry.suggestion.windowStart}`
        : `v${entry.version} ${entry.moment}`;

  it("merges stage events and revision moments, newest first", () => {
    const timeline = buildOrderTimeline(events, revisions, audits);
    expect(timeline.map(label)).toEqual([
      "v3 DECLINED",
      "v3 ISSUED",
      "v2 APPROVED",
      "v2 ISSUED",
      "stage IN_PROGRESS",
      "stage RECEIVED_BY_STORE",
    ]);
  });

  it("adds each pickup time the store suggested, so a replaced one stays in the history", () => {
    const suggestion = (id: string, minute: number, windowStart: string, isOutsideSchedule: boolean) => ({
      id,
      actorUserId: "kemi",
      createdAt: at(minute),
      date: "2026-10-20",
      windowStart,
      windowEnd: "12:00",
      isOutsideSchedule,
      note: isOutsideSchedule ? "Customer asked for early pickup" : null,
    });
    const timeline = buildOrderTimeline(events, [], [], [suggestion("s1", 2, "10:00", false), suggestion("s2", 7, "07:00", true)]);
    expect(timeline.map(label)).toEqual([
      "pickup 2026-10-20 07:00",
      "stage IN_PROGRESS",
      "pickup 2026-10-20 10:00",
      "stage RECEIVED_BY_STORE",
    ]);
    expect(timeline[0]).toMatchObject({
      kind: "pickupSuggested",
      suggestion: { isOutsideSchedule: true, note: "Customer asked for early pickup", actorUserId: "kemi" },
    });
  });

  it("gives each moment its difference, reason, and who decided", () => {
    const timeline = buildOrderTimeline(events, revisions, audits);
    expect(timeline.find((entry) => entry.key === "issued-r2")).toMatchObject({ difference: 250_000, reason: "Actual weight 4.2 kg", staffUserId: "ada" });
    // Compared with v2, approved by then.
    expect(timeline.find((entry) => entry.key === "issued-r3")).toMatchObject({ difference: 150_000 });
    expect(timeline.find((entry) => entry.key === "approved-r2")).toMatchObject({ decidedBy: "STAFF", staffUserId: "kemi" });
    expect(timeline.find((entry) => entry.key === "declined-r3")).toMatchObject({ decidedBy: "CUSTOMER", customerMessage: "Too expensive" });
  });

  it("orders a revision before the stage move it caused, and the approval before the return", () => {
    const timeline = buildOrderTimeline(
      [stage("e1", 0, null, "RECEIVED_BY_STORE"), stage("e2", 10, "RECEIVED_BY_STORE", "QUOTE_AWAITING_APPROVAL"), stage("e3", 20, "QUOTE_AWAITING_APPROVAL", "RECEIVED_BY_STORE")],
      [
        revision({ id: "r1", version: 1, total: 450_000 }),
        revision({ id: "r2", version: 2, status: "APPROVED", total: 630_000, createdAt: at(10), approvedAt: at(20), approvedByActor: "CUSTOMER" }),
      ],
      [],
    );
    expect(timeline.map((entry) => entry.key)).toEqual(["stage-e3", "approved-r2", "stage-e2", "issued-r2", "stage-e1"]);
    // The first priced quote has nothing approved to compare with.
    expect(timeline.find((entry) => entry.key === "issued-r2")).toMatchObject({ difference: null });
  });
});
