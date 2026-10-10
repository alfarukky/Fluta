import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { getPrisma } from "./client";

// A store's customers (one record per phone number per store). storeId always
// comes from the caller's membership, never from the request, and is part of
// every where clause: a customer ID from another store matches nothing.

const CUSTOMER_FIELDS = { id: true, name: true, phone: true, email: true } as const;

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string; // E.164
  email: string | null;
}

export const CUSTOMER_SEARCH_LIMIT = 8;

export async function findCustomer(storeId: string, id: string): Promise<CustomerRecord | null> {
  return getPrisma().customer.findUnique({ where: { storeId_id: { storeId, id } }, select: CUSTOMER_FIELDS });
}

export async function findCustomerByPhone(storeId: string, phone: string): Promise<CustomerRecord | null> {
  return getPrisma().customer.findUnique({ where: { storeId_phone: { storeId, phone } }, select: CUSTOMER_FIELDS });
}

// Customers whose name contains `name` (ignoring case), or whose phone number
// contains `phoneDigits`, alphabetically.
export async function searchCustomers(
  storeId: string,
  search: { name: string } | { phoneDigits: string },
): Promise<CustomerRecord[]> {
  const match: Prisma.CustomerWhereInput =
    "name" in search
      ? { name: { contains: search.name, mode: "insensitive" } }
      : { phone: { contains: search.phoneDigits } };
  return getPrisma().customer.findMany({
    where: { storeId, ...match },
    select: CUSTOMER_FIELDS,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: CUSTOMER_SEARCH_LIMIT,
  });
}

export interface NewCustomerData {
  name: string;
  phone: string; // E.164
  email: string | null;
}

// The store's customer with this phone number, created if there is none.
// An existing customer is never changed (their name is not overwritten).
// Part of the order transaction, which already holds the store row's lock,
// so two orders for the same new number at once share one customer.
export async function upsertCustomerByPhone(
  tx: Prisma.TransactionClient,
  storeId: string,
  data: NewCustomerData,
): Promise<{ id: string }> {
  return tx.customer.upsert({
    where: { storeId_phone: { storeId, phone: data.phone } },
    create: { storeId, name: data.name, phone: data.phone, email: data.email },
    update: {},
    select: { id: true },
  });
}
