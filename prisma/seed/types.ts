import type {
  ActorType,
  FulfilmentType,
  OrderChannel,
  OrderStage,
  PaymentMethod,
  PaymentSource,
  PickupWindowStatus,
  QuoteStatus,
  Service,
  ServiceArea,
} from "@/generated/prisma/client";

// A catalogue service line (by name) or an "Others" adjustment line.
// `quantity` is the billed quantity; leave it out on a quote-required line that
// hasn't been weighed or inspected yet. `estimate` is the customer's estimate.
export type SeedLine =
  | { service: string; quantity?: string; estimate?: string }
  | { adjustment: string; amount: number };

export interface SeedRevision {
  lines: SeedLine[];
  status: QuoteStatus;
  // Who approved it. Also set on a SUPERSEDED revision that was approved first.
  approvedBy?: ActorType;
  reason?: string;
  // Index into SeedOrder.stages: the revision is issued when that stage is entered.
  atStep?: number;
}

export interface SeedPayment {
  amount: number;
  source: PaymentSource;
  method: PaymentMethod;
  atStep: number;
  payerEmail?: string;
}

export interface SeedPickup {
  requestedInDays: number;
  window: [start: string, end: string];
  status: PickupWindowStatus;
  // A store-proposed window the customer accepted; defaults to `window`.
  scheduledWindow?: [start: string, end: string];
}

export interface SeedOrder {
  customerPhone: string;
  channel: OrderChannel;
  fulfilmentType: FulfilmentType;
  createdHoursAgo: number;
  // Every stage the order has passed through, ending with its current stage.
  stages: OrderStage[];
  // Version 1 first; the order's lines are the latest revision's lines.
  revisions: SeedRevision[];
  area?: string;
  addressText?: string;
  pickup?: SeedPickup;
  payLater?: boolean;
  payments?: SeedPayment[];
  cancelNote?: string;
  internalNote?: string;
  linkSmsFailed?: boolean;
}

export interface SeedStoreContext {
  now: Date;
  storeId: string;
  orderPrefix: string;
  // The seeded user recorded as the staff actor on this store's orders.
  staffUserId: string;
  customerIds: Map<string, string>;
  services: Map<string, Service>;
  areas: Map<string, ServiceArea>;
}
