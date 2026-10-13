import "server-only";

import type { FulfilmentType, OrderLineType, PricingType } from "@/generated/prisma/client";
import { lineTotalKobo } from "@/lib/money";
import { getOrderTotal, isOrderFullyPriced, mergeServiceLines } from "@/lib/order-pricing";
import { getQuantityProblem, isWeighed, MAX_ITEM_QUANTITY } from "@/lib/quantity";
import { isRevisionReasonRequired } from "@/lib/quotes";

import { buildQuoteSnapshot, type PricedOrderLine, type QuoteSnapshot, type SnapshotFulfilment } from "./orders";

// Pricing a quote revision. Pure: the caller loads the order's lines, the
// catalogue, and the area. Existing service lines keep the unit price they
// were added at; only newly added lines use today's catalogue price. The
// browser sends IDs, quantities, and Others lines, never a price.

// A service line already on the order (its working copy).
export interface ExistingOrderLine {
  id: string;
  lineType: OrderLineType;
  serviceId: string | null;
  description: string;
  pricingType: PricingType | null;
  requiresQuote: boolean;
  unitPrice: number | null;
  estimate: number | null; // hundredths
}

// An active catalogue service, priced today.
export interface CatalogueServicePrice {
  id: string;
  name: string;
  pricingType: PricingType;
  price: number;
  requiresQuote: boolean;
}

export type RevisionLineRequest =
  | { kind: "existing"; lineId: string; quantity: number | null }
  | { kind: "new"; serviceId: string; quantity: number | null };

export interface RevisionLinesRequest {
  lines: readonly RevisionLineRequest[];
  // Signed: positive extra charges, negative discounts.
  adjustments: readonly { description: string; amount: number }[];
}

export type RevisionProblem = "LINE_UNAVAILABLE" | "SERVICE_UNAVAILABLE" | "INVALID_QUANTITY" | "NO_SERVICES";

export type PricedRevisionLines =
  | { ok: true; lines: PricedOrderLine[] }
  | { ok: false; problem: RevisionProblem; fieldErrors: Record<string, string> };

const QUANTITY_REQUIRED = { weight: "Enter the weight", items: "Enter how many" };
const QUANTITY_MESSAGES = {
  weight: { INVALID: "Enter the weight in kg, like 2.5", TOO_SMALL: "Enter at least 0.1 kg", TOO_LARGE: "Enter 999.99 kg or less" },
  items: { INVALID: "Enter a whole number", TOO_SMALL: "Enter at least 1", TOO_LARGE: `Enter ${MAX_ITEM_QUANTITY} or fewer` },
};

// Every service line needs its quantity: a revision is always fully priced.
function getQuantityMessage(pricingType: PricingType, quantity: number | null): string | null {
  const kind = isWeighed(pricingType) ? "weight" : "items";
  if (quantity === null) return QUANTITY_REQUIRED[kind];
  const problem = getQuantityProblem(quantity, pricingType);
  return problem ? QUANTITY_MESSAGES[kind][problem] : null;
}

export function priceRevisionLines(
  existing: readonly ExistingOrderLine[],
  catalogue: ReadonlyMap<string, CatalogueServicePrice>,
  request: RevisionLinesRequest,
): PricedRevisionLines {
  const fieldErrors: Record<string, string> = {};
  let problem: RevisionProblem | null = null;
  const report = (field: string, message: string, kind: RevisionProblem) => {
    fieldErrors[field] ??= message;
    problem ??= kind;
  };

  const existingById = new Map(
    existing.filter((line) => line.lineType === "SERVICE").map((line) => [line.id, line]),
  );
  const used = new Set<string>();
  const kept: PricedOrderLine[] = [];
  const added: { index: number; serviceId: string; quantity: number | null; estimate: null }[] = [];

  for (const [index, line] of request.lines.entries()) {
    if (line.kind === "new") {
      added.push({ index, serviceId: line.serviceId, quantity: line.quantity, estimate: null });
      continue;
    }
    const current = existingById.get(line.lineId);
    // Another revision replaced the lines, or the ID isn't this order's.
    if (!current || used.has(line.lineId) || current.pricingType === null || current.unitPrice === null) {
      report(`lines.${index}`, "This line has changed. Reload the page and try again.", "LINE_UNAVAILABLE");
      continue;
    }
    used.add(line.lineId);
    const message = getQuantityMessage(current.pricingType, line.quantity);
    if (message || line.quantity === null) {
      report(`lines.${index}.quantity`, message ?? QUANTITY_REQUIRED.items, "INVALID_QUANTITY");
      continue;
    }
    kept.push({
      lineType: "SERVICE",
      serviceId: current.serviceId,
      description: current.description,
      pricingType: current.pricingType,
      requiresQuote: current.requiresQuote,
      // The price the line was added at, whatever the catalogue says now.
      unitPrice: current.unitPrice,
      quantity: line.quantity,
      estimate: current.estimate,
      lineTotal: lineTotalKobo(current.unitPrice, line.quantity),
    });
  }

  // New lines for the same service become one line, as on a new order.
  const firstIndex = new Map<string, number>();
  for (const line of added) if (!firstIndex.has(line.serviceId)) firstIndex.set(line.serviceId, line.index);
  const fresh: PricedOrderLine[] = [];
  for (const line of mergeServiceLines(added)) {
    const index = firstIndex.get(line.serviceId) ?? line.index;
    const service = catalogue.get(line.serviceId);
    if (!service) {
      report(`lines.${index}.serviceId`, "This service isn't available any more. Remove it.", "SERVICE_UNAVAILABLE");
      continue;
    }
    const message = getQuantityMessage(service.pricingType, line.quantity);
    if (message || line.quantity === null) {
      report(`lines.${index}.quantity`, message ?? QUANTITY_REQUIRED.items, "INVALID_QUANTITY");
      continue;
    }
    fresh.push({
      lineType: "SERVICE",
      serviceId: service.id,
      description: service.name,
      pricingType: service.pricingType,
      requiresQuote: service.requiresQuote,
      unitPrice: service.price,
      quantity: line.quantity,
      estimate: null,
      lineTotal: lineTotalKobo(service.price, line.quantity),
    });
  }

  if (problem) return { ok: false, problem, fieldErrors };
  if (kept.length + fresh.length === 0) {
    return { ok: false, problem: "NO_SERVICES", fieldErrors: { lines: "Add at least one service" } };
  }

  const others = request.adjustments.map(
    (adjustment): PricedOrderLine => ({
      lineType: "ADJUSTMENT",
      serviceId: null,
      description: adjustment.description,
      pricingType: null,
      requiresQuote: false,
      unitPrice: null,
      quantity: null,
      estimate: null,
      lineTotal: adjustment.amount,
    }),
  );
  return { ok: true, lines: [...kept, ...fresh, ...others] };
}

export type RevisionCheckProblem = "NOT_FULLY_PRICED" | "NEGATIVE_TOTAL" | "REASON_REQUIRED";

export interface RevisionCheck {
  fulfilmentType: FulfilmentType;
  lines: readonly PricedOrderLine[];
  fulfilment: SnapshotFulfilment;
  hasApprovedQuote: boolean;
  reason: string | null;
}

export type BuiltRevision =
  | { ok: true; linesSnapshot: QuoteSnapshot; itemsSubtotal: number; fulfilmentCharge: number; total: number }
  | { ok: false; problem: RevisionCheckProblem; field: string };

// The revision's totals and snapshot, once it is fully priced, not negative,
// and has a reason where one is required.
export function buildRevision(check: RevisionCheck): BuiltRevision {
  const fullyPriced = isOrderFullyPriced({
    fulfilmentType: check.fulfilmentType,
    lines: check.lines.filter((line) => line.lineType === "SERVICE"),
    fulfilmentCharge: check.fulfilment.charge,
  });
  if (!fullyPriced) return { ok: false, problem: "NOT_FULLY_PRICED", field: check.fulfilment.charge === null ? "charge" : "lines" };

  const total = getOrderTotal({
    serviceLineTotals: check.lines.filter((line) => line.lineType === "SERVICE").map((line) => line.lineTotal),
    adjustments: check.lines.filter((line) => line.lineType === "ADJUSTMENT").map((line) => line.lineTotal ?? 0),
    fulfilmentCharge: check.fulfilment.charge,
  });
  if (total < 0) return { ok: false, problem: "NEGATIVE_TOTAL", field: "adjustments" };
  if (isRevisionReasonRequired(check.hasApprovedQuote) && !check.reason) {
    return { ok: false, problem: "REASON_REQUIRED", field: "reason" };
  }

  return { ok: true, ...buildQuoteSnapshot(check.lines, check.fulfilment) };
}

// ───────────── Pickup area and charge ─────────────

export type RevisionAreaRequest =
  | { kind: "current" }
  | { kind: "area"; areaId: string }
  | { kind: "outOfArea"; name: string };

export interface OrderFulfilment {
  fulfilmentType: FulfilmentType;
  serviceAreaId: string | null;
  serviceAreaName: string | null;
  isOutOfArea: boolean;
  fulfilmentCharge: number | null;
}

export interface AreaCharge {
  id: string;
  name: string;
  chargeType: "FIXED" | "QUOTE_REQUIRED";
  fixedCharge: number | null;
}

export interface RevisionFulfilmentInput {
  order: OrderFulfilment;
  // The order's own area as it is now (even if disabled since), if it has one.
  currentArea: AreaCharge | null;
  // The newly chosen area, only if it is one of the store's active areas.
  chosenArea: AreaCharge | null;
  request: { area: RevisionAreaRequest; charge: number | null };
}

export type ResolvedFulfilment =
  | {
      ok: true;
      fields: Pick<OrderFulfilment, "serviceAreaId" | "serviceAreaName" | "isOutOfArea" | "fulfilmentCharge">;
      snapshot: SnapshotFulfilment;
    }
  | { ok: false; field: "area" | "charge"; message: string };

const isFixed = (area: AreaCharge | null): area is AreaCharge & { fixedCharge: number } =>
  area !== null && area.chargeType === "FIXED" && area.fixedCharge !== null;

// Whether staff enter the charge when the order keeps its area: a
// quote-required area, or outside the service areas. A fixed area's charge
// comes from the area.
export function isCurrentChargeEntered(order: OrderFulfilment, currentArea: AreaCharge | null): boolean {
  return order.isOutOfArea || !isFixed(currentArea);
}

// The pickup area and charge a revision uses, following Feature 09's copy
// rules: the area's name is copied onto the order, and an out-of-area name is
// kept on the order only.
export function resolveRevisionFulfilment({ order, currentArea, chosenArea, request }: RevisionFulfilmentInput): ResolvedFulfilment {
  if (order.fulfilmentType === "DROP_OFF") {
    return {
      ok: true,
      fields: { serviceAreaId: null, serviceAreaName: null, isOutOfArea: false, fulfilmentCharge: null },
      snapshot: { areaName: null, isOutOfArea: false, charge: null },
    };
  }

  const entered = (fields: Omit<OrderFulfilment, "fulfilmentType" | "fulfilmentCharge">): ResolvedFulfilment =>
    request.charge === null
      ? { ok: false, field: "charge", message: "Enter the pickup & delivery charge, or 0" }
      : done({ ...fields, fulfilmentCharge: request.charge });

  switch (request.area.kind) {
    case "current":
      if (isCurrentChargeEntered(order, currentArea)) return entered(order);
      // Keeps the charge already on the order, as existing lines keep their price.
      return done({ ...order, fulfilmentCharge: order.fulfilmentCharge ?? currentArea?.fixedCharge ?? null });
    case "outOfArea":
      return entered({ serviceAreaId: null, serviceAreaName: request.area.name, isOutOfArea: true });
    case "area": {
      if (!chosenArea || chosenArea.id !== request.area.areaId) {
        return { ok: false, field: "area", message: "This area isn't available any more. Choose another." };
      }
      const fields = { serviceAreaId: chosenArea.id, serviceAreaName: chosenArea.name, isOutOfArea: false };
      return isFixed(chosenArea) ? done({ ...fields, fulfilmentCharge: chosenArea.fixedCharge }) : entered(fields);
    }
  }
}

function done(fields: Pick<OrderFulfilment, "serviceAreaId" | "serviceAreaName" | "isOutOfArea" | "fulfilmentCharge">): ResolvedFulfilment {
  const { serviceAreaId, serviceAreaName, isOutOfArea, fulfilmentCharge } = fields;
  return {
    ok: true,
    fields: { serviceAreaId, serviceAreaName, isOutOfArea, fulfilmentCharge },
    snapshot: { areaName: serviceAreaName, isOutOfArea, charge: fulfilmentCharge },
  };
}
