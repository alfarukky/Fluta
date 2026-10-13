import type { PricingType } from "@/generated/prisma/enums";
import { formatNairaInput, lineTotalKobo, parseNairaToKobo } from "@/lib/money";
import { getOrderTotal, isOrderFullyPriced } from "@/lib/order-pricing";
import { getQuantityProblem, isWeighed, parseHundredths } from "@/lib/quantity";
import { getTotalDifference } from "@/lib/quotes";
import type { IssueRevisionRequest } from "@/schemas/quotes";
import type { OrderEntryArea, OrderEntryService, QuoteEditorData } from "@/types/orders";

import { OUT_OF_AREA, type AdjustmentDraft } from "./order-draft";

// The edit-quote screen's state, what it sends, and its live preview. The
// preview is only a preview: the server rebuilds every price. Lines already
// on the order keep the unit price they were added at; added lines use
// today's catalogue price.

export const CURRENT_AREA = "CURRENT";

export interface QuoteLineDraft {
  key: string;
  // An existing line's ID, or the service of a newly added line.
  source: { kind: "existing"; lineId: string } | { kind: "new"; serviceId: string };
  name: string;
  pricingType: PricingType;
  unitPrice: number;
  quantity: string;
  // The customer's estimate on an unweighed line (shown as a hint, never billed).
  estimate: number | null;
}

export interface QuoteDraft {
  lines: QuoteLineDraft[];
  adjustments: AdjustmentDraft[];
  // CURRENT_AREA, an area ID, or OUT_OF_AREA.
  areaChoice: string;
  outOfAreaName: string;
  charge: string;
  reason: string;
}

// "3", "4.25": a quantity as staff would type it.
export function quantityInput(hundredths: number | null): string {
  if (hundredths === null) return "";
  const whole = Math.trunc(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function initialQuoteDraft(editor: QuoteEditorData): QuoteDraft {
  return {
    lines: editor.lines.map((line) => ({
      key: line.id,
      source: { kind: "existing", lineId: line.id },
      name: line.name,
      pricingType: line.pricingType,
      unitPrice: line.unitPrice,
      quantity: quantityInput(line.quantity),
      estimate: line.estimate,
    })),
    adjustments: editor.adjustments.map((adjustment, index) => ({
      key: `adjustment-${index}`,
      description: adjustment.description,
      kind: adjustment.amount < 0 ? "DISCOUNT" : "CHARGE",
      amount: formatNairaInput(adjustment.amount),
    })),
    areaChoice: CURRENT_AREA,
    outOfAreaName: "",
    charge: editor.pickup?.charge === null || editor.pickup === null ? "" : formatNairaInput(editor.pickup.charge),
    reason: "",
  };
}

// Adding a service: a new line at today's price, or one more on a line
// already added in this edit. Lines already on the order are left alone, so
// they keep their original price.
export function addQuoteService(lines: readonly QuoteLineDraft[], service: OrderEntryService, key: string): QuoteLineDraft[] {
  const added = lines.find((line) => line.source.kind === "new" && line.source.serviceId === service.id);
  if (!added) {
    return [
      ...lines,
      {
        key,
        source: { kind: "new", serviceId: service.id },
        name: service.name,
        pricingType: service.pricingType,
        unitPrice: service.price,
        quantity: isWeighed(service.pricingType) ? "" : "1",
        estimate: null,
      },
    ];
  }
  if (isWeighed(service.pricingType)) return [...lines];
  const current = parseHundredths(added.quantity);
  const next = current === null ? "1" : String(Math.floor(current / 100) + 1);
  return lines.map((line) => (line === added ? { ...line, quantity: next } : line));
}

// Whether staff type the charge for the area chosen.
export function isChargeEntered(draft: QuoteDraft, editor: QuoteEditorData, areas: readonly OrderEntryArea[]): boolean {
  if (!editor.pickup) return false;
  if (draft.areaChoice === CURRENT_AREA) return editor.pickup.chargeEntered;
  if (draft.areaChoice === OUT_OF_AREA) return true;
  const area = areas.find((candidate) => candidate.id === draft.areaChoice);
  return area === undefined || area.chargeType === "QUOTE_REQUIRED" || area.fixedCharge === null;
}

export function toIssueRevisionRequest(
  draft: QuoteDraft,
  editor: QuoteEditorData,
  areas: readonly OrderEntryArea[],
): IssueRevisionRequest {
  const area: IssueRevisionRequest["area"] =
    draft.areaChoice === CURRENT_AREA
      ? { kind: "current" }
      : draft.areaChoice === OUT_OF_AREA
        ? { kind: "outOfArea", name: draft.outOfAreaName }
        : { kind: "area", areaId: draft.areaChoice };
  return {
    orderId: editor.orderId,
    basedOnVersion: editor.latestVersion,
    lines: draft.lines.map((line) =>
      line.source.kind === "existing"
        ? { kind: "existing", lineId: line.source.lineId, quantity: line.quantity }
        : { kind: "new", serviceId: line.source.serviceId, quantity: line.quantity },
    ),
    adjustments: draft.adjustments.map(({ description, kind, amount }) => ({ description, kind, amount })),
    area: editor.pickup ? area : { kind: "current" },
    charge: isChargeEntered(draft, editor, areas) ? draft.charge : "",
    reason: draft.reason,
  };
}

export interface QuoteReview {
  lineTotals: Map<string, number | null>;
  charge: number | null;
  total: number;
  fullyPriced: boolean;
  // Against the last approved total; null when nothing is approved yet.
  difference: number | null;
}

export function reviewQuoteDraft(draft: QuoteDraft, editor: QuoteEditorData, areas: readonly OrderEntryArea[]): QuoteReview {
  const lineTotals = new Map<string, number | null>();
  const priced = draft.lines.map((line) => {
    const parsed = parseHundredths(line.quantity);
    const quantity = parsed !== null && getQuantityProblem(parsed, line.pricingType) === null ? parsed : null;
    const total = quantity === null ? null : lineTotalKobo(line.unitPrice, quantity);
    lineTotals.set(line.key, total);
    // Every line needs its quantity in a revision.
    return { requiresQuote: true, quantity, total };
  });
  const adjustments = draft.adjustments.map((adjustment) => {
    const kobo = parseNairaToKobo(adjustment.amount) ?? 0;
    return adjustment.kind === "DISCOUNT" ? -kobo : kobo;
  });
  const charge = previewCharge(draft, editor, areas);
  const total = getOrderTotal({ serviceLineTotals: priced.map((line) => line.total), adjustments, fulfilmentCharge: charge });

  return {
    lineTotals,
    charge,
    total,
    fullyPriced:
      priced.length > 0 &&
      isOrderFullyPriced({ fulfilmentType: editor.fulfilmentType, lines: priced, fulfilmentCharge: charge }),
    difference: getTotalDifference(editor.approvedTotal, total),
  };
}

function previewCharge(draft: QuoteDraft, editor: QuoteEditorData, areas: readonly OrderEntryArea[]): number | null {
  if (!editor.pickup) return null;
  if (isChargeEntered(draft, editor, areas)) return draft.charge.trim() ? parseNairaToKobo(draft.charge) : null;
  if (draft.areaChoice === CURRENT_AREA) return editor.pickup.charge;
  return areas.find((area) => area.id === draft.areaChoice)?.fixedCharge ?? null;
}
