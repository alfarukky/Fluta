import type { FulfilmentType, OrderStage } from "@/generated/prisma/enums";
import { lineTotalKobo, parseNairaToKobo } from "@/lib/money";
import { getOrderTotal, isOrderFullyPriced } from "@/lib/order-pricing";
import { getInitialStage, type StaffChannel } from "@/lib/orders";
import { getQuantityProblem, isWeighed, parseHundredths } from "@/lib/quantity";
import type { AdjustmentKind, CreateOrderRequest } from "@/schemas/orders";
import type { CustomerMatch, OrderEntryArea, OrderEntryService } from "@/types/orders";

// The new-order form's state, what it sends, and its live review. The review
// is a preview only: the server recomputes every price from the catalogue.

export const OUT_OF_AREA = "OUT_OF_AREA";

export interface ServiceLineDraft {
  key: string;
  serviceId: string;
  quantity: string;
  estimate: string;
}

export interface AdjustmentDraft {
  key: string;
  description: string;
  kind: AdjustmentKind;
  amount: string;
}

export interface NewCustomerDraft {
  name: string;
  phone: string;
  email: string;
}

export interface OrderDraft {
  customerMode: "existing" | "new";
  selectedCustomer: CustomerMatch | null;
  newCustomer: NewCustomerDraft;
  // An existing customer with the new customer's phone number: the order is
  // theirs, and their name is kept.
  phoneMatch: CustomerMatch | null;
  channel: StaffChannel;
  fulfilmentType: FulfilmentType;
  // An area ID, OUT_OF_AREA, or "" before one is chosen.
  areaChoice: string;
  outOfAreaName: string;
  address: string;
  date: string; // "YYYY-MM-DD"
  // "08:00-10:00" for a normal window.
  windowKey: string;
  outsideSchedule: boolean;
  customStart: string; // "HH:MM"
  customEnd: string;
  charge: string;
  serviceLines: ServiceLineDraft[];
  adjustments: AdjustmentDraft[];
  internalNote: string;
}

export function emptyDraft(fulfilmentType: FulfilmentType): OrderDraft {
  return {
    customerMode: "existing",
    selectedCustomer: null,
    newCustomer: { name: "", phone: "", email: "" },
    phoneMatch: null,
    channel: "COUNTER",
    fulfilmentType,
    areaChoice: "",
    outOfAreaName: "",
    address: "",
    date: "",
    windowKey: "",
    outsideSchedule: false,
    customStart: "",
    customEnd: "",
    charge: "",
    serviceLines: [],
    adjustments: [],
    internalNote: "",
  };
}

export function windowKey(start: string, end: string): string {
  return `${start}-${end}`;
}

// Whether staff enter the charge: a quote-required area, or outside the areas.
export function needsEnteredCharge(draft: OrderDraft, areas: readonly OrderEntryArea[]): boolean {
  if (draft.areaChoice === OUT_OF_AREA) return true;
  const area = areas.find((candidate) => candidate.id === draft.areaChoice);
  return area !== undefined && (area.chargeType === "QUOTE_REQUIRED" || area.fixedCharge === null);
}

// What the form sends: services and quantities as typed, never prices.
export function toCreateOrderRequest(draft: OrderDraft, clientRequestId: string, areas: readonly OrderEntryArea[]): CreateOrderRequest {
  const customer: CreateOrderRequest["customer"] =
    draft.customerMode === "existing" || draft.phoneMatch
      ? { kind: "existing", customerId: (draft.phoneMatch ?? draft.selectedCustomer)?.id ?? "" }
      : { kind: "new", ...draft.newCustomer };
  const pickup = draft.fulfilmentType === "PICKUP_DELIVERY";
  const [windowStart = "", windowEnd = ""] = draft.outsideSchedule
    ? [draft.customStart, draft.customEnd]
    : draft.windowKey.split("-");

  return {
    clientRequestId,
    customer,
    channel: draft.channel,
    fulfilmentType: draft.fulfilmentType,
    pickup: pickup
      ? {
          area:
            draft.areaChoice === OUT_OF_AREA
              ? { kind: "outOfArea", name: draft.outOfAreaName }
              : { kind: "area", areaId: draft.areaChoice },
          address: draft.address,
          date: draft.date,
          outsideSchedule: draft.outsideSchedule,
          windowStart,
          windowEnd,
          charge: needsEnteredCharge(draft, areas) ? draft.charge : "",
        }
      : null,
    serviceLines: draft.serviceLines.map(({ serviceId, quantity, estimate }) => ({ serviceId, quantity, estimate })),
    adjustments: draft.adjustments.map(({ description, kind, amount }) => ({ description, kind, amount })),
    internalNote: draft.internalNote,
  };
}

export interface ReviewLine {
  key: string;
  description: string;
  // Null while unweighed, or while the quantity typed isn't valid yet.
  lineTotal: number | null;
  awaitingWeight: boolean;
}

export interface OrderReview {
  serviceLines: ReviewLine[];
  adjustments: { key: string; description: string; amount: number | null }[];
  fulfilmentCharge: number | null;
  total: number;
  fullyPriced: boolean;
  stage: OrderStage;
}

// The review section: line totals, the total so far, and where the order
// will start.
export function reviewDraft(
  draft: OrderDraft,
  services: readonly OrderEntryService[],
  areas: readonly OrderEntryArea[],
): OrderReview {
  const byId = new Map(services.map((service) => [service.id, service]));
  const serviceLines = draft.serviceLines.flatMap((line): (ReviewLine & { requiresQuote: boolean; quantity: number | null })[] => {
    const service = byId.get(line.serviceId);
    if (!service) return [];
    const parsed = parseHundredths(line.quantity);
    const quantity = parsed !== null && getQuantityProblem(parsed, service.pricingType) === null ? parsed : null;
    return [
      {
        key: line.key,
        description: service.name,
        lineTotal: quantity === null ? null : lineTotalKobo(service.price, quantity),
        awaitingWeight: isWeighed(service.pricingType) && line.quantity.trim() === "",
        requiresQuote: service.requiresQuote,
        quantity,
      },
    ];
  });
  const adjustments = draft.adjustments.map((adjustment) => {
    const kobo = parseNairaToKobo(adjustment.amount);
    return {
      key: adjustment.key,
      description: adjustment.description.trim() || "Others",
      amount: kobo === null ? null : adjustment.kind === "DISCOUNT" ? -kobo : kobo,
    };
  });
  const fulfilmentCharge = previewCharge(draft, areas);

  return {
    serviceLines: serviceLines.map(({ key, description, lineTotal, awaitingWeight }) => ({ key, description, lineTotal, awaitingWeight })),
    adjustments,
    fulfilmentCharge,
    total: getOrderTotal({
      serviceLineTotals: serviceLines.map((line) => line.lineTotal),
      adjustments: adjustments.map((adjustment) => adjustment.amount ?? 0),
      fulfilmentCharge,
    }),
    fullyPriced: isOrderFullyPriced({ fulfilmentType: draft.fulfilmentType, lines: serviceLines, fulfilmentCharge }),
    stage: getInitialStage(draft.channel, draft.fulfilmentType),
  };
}

function previewCharge(draft: OrderDraft, areas: readonly OrderEntryArea[]): number | null {
  if (draft.fulfilmentType !== "PICKUP_DELIVERY") return null;
  if (needsEnteredCharge(draft, areas)) return draft.charge.trim() ? parseNairaToKobo(draft.charge) : null;
  return areas.find((area) => area.id === draft.areaChoice)?.fixedCharge ?? null;
}

// Adding a service already on the order adds to its line ("Shirt × 2" plus
// one more is "Shirt × 3"); a per-kg line is weighed as a whole, so it is
// left as it is. Returns the lines and whether an existing line was used.
export function addService(
  lines: readonly ServiceLineDraft[],
  service: OrderEntryService,
  key: string,
): { lines: ServiceLineDraft[]; combined: boolean } {
  const existing = lines.find((line) => line.serviceId === service.id);
  if (!existing) {
    const quantity = isWeighed(service.pricingType) ? "" : "1";
    return { lines: [...lines, { key, serviceId: service.id, quantity, estimate: "" }], combined: false };
  }
  if (isWeighed(service.pricingType)) return { lines: [...lines], combined: true };
  const current = parseHundredths(existing.quantity);
  const next = current === null ? "1" : String(Math.floor(current / 100) + 1);
  return {
    lines: lines.map((line) => (line === existing ? { ...line, quantity: next } : line)),
    combined: true,
  };
}
