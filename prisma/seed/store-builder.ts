import {
  InvoiceStatus,
  PricingType,
  StoreRole,
  type AreaChargeType,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";

import { toMatchKey } from "@/lib/match-key";
import { createMembership } from "@/server/data/memberships";

import { lagosDate } from "./helpers";
import { createSeedOrder } from "./order-builder";
import type { SeedOrder, SeedStoreContext } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedStoreSpec {
  store: Omit<Prisma.StoreCreateInput, "id">;
  areas: { name: string; chargeType: AreaChargeType; fixedCharge?: number }[];
  services: { name: string; category: string; pricingType: PricingType; price: number; requiresQuote?: boolean }[];
  customers: { name: string; phone: string; email?: string }[];
  closedDates: { date: Date; note: string }[];
  subscription: {
    planName: string;
    priceAmount: number;
    // The current billing period started this many days ago.
    periodStartedDaysAgo: number;
    graceDays?: number;
  };
  orders: SeedOrder[];
}

export interface SeedStoreResult {
  storeId: string;
  name: string;
  orderNumbers: number[];
}

// The store's seeded users. The owner is recorded as the staff actor on orders.
export interface SeedStoreMembers {
  ownerUserId: string;
  staffUserIds: string[];
}

export async function seedStore(
  prisma: PrismaClient,
  now: Date,
  spec: SeedStoreSpec,
  members: SeedStoreMembers,
): Promise<SeedStoreResult> {
  const store = await prisma.store.create({ data: spec.store, select: { id: true, orderPrefix: true } });
  const storeId = store.id;
  await seedMemberships(prisma, storeId, members);

  const areas = await Promise.all(
    spec.areas.map((area) => prisma.serviceArea.create({ data: { ...area, storeId } })),
  );
  const services = await Promise.all(
    spec.services.map((service) =>
      prisma.service.create({
        data: {
          ...service,
          nameKey: toMatchKey(service.name),
          // Per-kg services always require a quote.
          requiresQuote: service.pricingType === PricingType.PER_KG || (service.requiresQuote ?? false),
          storeId,
        },
      }),
    ),
  );
  const customers = await Promise.all(
    spec.customers.map((customer) => prisma.customer.create({ data: { ...customer, storeId } })),
  );
  await prisma.closedDate.createMany({ data: spec.closedDates.map((closed) => ({ ...closed, storeId })) });
  await seedSubscription(prisma, now, storeId, spec.subscription);

  const ctx: SeedStoreContext = {
    now,
    storeId,
    orderPrefix: store.orderPrefix,
    staffUserId: members.ownerUserId,
    customerIds: new Map(customers.map((customer) => [customer.phone, customer.id])),
    services: new Map(services.map((service) => [service.name, service])),
    areas: new Map(areas.map((area) => [area.name, area])),
  };

  // Sequentially, oldest first, so order numbers follow creation time.
  const orderNumbers: number[] = [];
  for (const order of spec.orders) {
    orderNumbers.push(await createSeedOrder(prisma, ctx, order));
  }
  return { storeId, name: spec.store.name, orderNumbers };
}

async function seedMemberships(prisma: PrismaClient, storeId: string, members: SeedStoreMembers): Promise<void> {
  const roles = [
    { userId: members.ownerUserId, role: StoreRole.OWNER },
    ...members.staffUserIds.map((userId) => ({ userId, role: StoreRole.STAFF })),
  ];
  for (const member of roles) {
    const result = await createMembership(storeId, member, prisma);
    if (!result.success) throw new Error(`Seed data: user ${member.userId} already has an active membership.`);
  }
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

// Last period's invoice is paid; the current one is open. Whether it's overdue
// is derived from its due date and graceDays, never stored.
async function seedSubscription(
  prisma: PrismaClient,
  now: Date,
  storeId: string,
  spec: SeedStoreSpec["subscription"],
): Promise<void> {
  const periodStart = lagosDate(now, -spec.periodStartedDaysAgo);
  const periodEnd = addDays(addMonths(periodStart, 1), -1);
  const previousStart = addMonths(periodStart, -1);

  await prisma.subscription.create({
    data: {
      storeId,
      planName: spec.planName,
      priceAmount: spec.priceAmount,
      graceDays: spec.graceDays ?? 7,
      currentPeriodEnd: periodEnd,
      invoices: {
        create: [
          {
            amount: spec.priceAmount,
            periodStart: previousStart,
            periodEnd: addDays(periodStart, -1),
            dueDate: addDays(previousStart, 7),
            status: InvoiceStatus.PAID,
            amountPaid: spec.priceAmount,
            paymentMethod: "Bank transfer",
            paymentReference: "Seed transfer",
            paidAt: addDays(previousStart, 3),
          },
          {
            amount: spec.priceAmount,
            periodStart,
            periodEnd,
            dueDate: addDays(periodStart, 7),
            status: InvoiceStatus.OPEN,
          },
        ],
      },
    },
  });
}
