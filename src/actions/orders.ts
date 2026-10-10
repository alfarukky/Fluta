"use server";

import { revalidatePath } from "next/cache";

import { formatPhone } from "@/lib/phone";
import {
  createOrderSchema,
  customerPhoneSchema,
  customerSearchSchema,
  STORE_NOT_ACCEPTING_MESSAGE,
} from "@/schemas/orders";
import { requireStoreMember } from "@/server/auth/session";
import type { CustomerRecord } from "@/server/data/customers";
import { createStaffOrder, findCustomers, getCustomerByPhone, type OrderEntryError } from "@/server/services/order-entry";
import type { CustomerMatch } from "@/types/orders";

// Staff order entry. Each action checks the membership itself (every action
// is its own request); creating also needs a store that is accepting new
// orders (getStoreAccess). The store is always the member's own: customer,
// service, and area IDs in the request are only used if they belong to it.

export type CreateOrderErrorCode =
  | OrderEntryError
  | "NOT_ALLOWED"
  | "STORE_NOT_ACCEPTING_ORDERS"
  | "REQUEST_ID_REQUIRED"
  | "INVALID_INPUT"
  | "CREATE_FAILED";

export type CreateOrderActionResult =
  | { ok: true; orderId: string; message: string }
  | { ok: false; code: CreateOrderErrorCode; message: string; fieldErrors?: Record<string, string> };

const ERROR_MESSAGES: Record<OrderEntryError, string> = {
  FULFILMENT_NOT_OFFERED: "Your store doesn't offer this fulfilment option right now.",
  CUSTOMER_NOT_FOUND: "We couldn't find this customer.",
  SERVICE_UNAVAILABLE: "A service on this order isn't available any more.",
  INVALID_QUANTITY: "Check the quantities and try again.",
  AREA_UNAVAILABLE: "This service area isn't available any more.",
  CHARGE_REQUIRED: "Enter the pickup & delivery charge.",
  PICKUP_NOT_AVAILABLE: "Check the pickup date and time.",
  NEGATIVE_TOTAL: "The order total can't be less than ₦0.",
};

export async function createOrder(request: unknown): Promise<CreateOrderActionResult> {
  const member = await requireStoreMember();
  if (!member.allowed) return { ok: false, code: "NOT_ALLOWED", message: "You can't create orders for this store." };
  if (!member.access.canAcceptNewOrders) {
    return { ok: false, code: "STORE_NOT_ACCEPTING_ORDERS", message: STORE_NOT_ACCEPTING_MESSAGE };
  }

  const parsed = createOrderSchema.safeParse(request);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "clientRequestId")) {
      return { ok: false, code: "REQUEST_ID_REQUIRED", message: "This form has expired. Reload the page and try again." };
    }
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Check the highlighted fields and try again.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  try {
    const result = await createStaffOrder(
      { storeId: member.store.id, timeZone: member.store.timeZone, userId: member.user.id },
      parsed.data,
      new Date(),
    );
    if (!result.ok) {
      return { ok: false, code: result.error, message: ERROR_MESSAGES[result.error], fieldErrors: result.fieldErrors };
    }
    revalidatePath("/orders");
    return {
      ok: true,
      orderId: result.orderId,
      message: `Order ${result.displayNumber} created`,
    };
  } catch (error) {
    console.error(`[orders] creating an order for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, code: "CREATE_FAILED", message: "We couldn't create this order. Please try again." };
  }
}

export type CustomerSearchResult = { ok: true; customers: CustomerMatch[] } | { ok: false; message: string };

// Search by phone number or name, within the member's own store.
export async function searchCustomers(query: unknown): Promise<CustomerSearchResult> {
  const member = await requireStoreMember();
  if (!member.allowed) return { ok: false, message: "You can't search this store's customers." };

  const text = customerSearchSchema.safeParse(query);
  if (!text.success) return { ok: true, customers: [] };
  try {
    return { ok: true, customers: (await findCustomers(member.store.id, text.data)).map(toCustomerMatch) };
  } catch (error) {
    console.error(`[orders] customer search for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, message: "We couldn't search customers. Please try again." };
  }
}

export type CustomerPhoneResult = { ok: true; customer: CustomerMatch | null } | { ok: false; message: string };

// The store's existing customer with this phone number, if any, so the form
// can show their name instead of creating a duplicate.
export async function findCustomerByPhone(phone: unknown): Promise<CustomerPhoneResult> {
  const member = await requireStoreMember();
  if (!member.allowed) return { ok: false, message: "You can't search this store's customers." };

  const e164 = customerPhoneSchema.safeParse(phone);
  if (!e164.success) return { ok: true, customer: null };
  try {
    const customer = await getCustomerByPhone(member.store.id, e164.data);
    return { ok: true, customer: customer && toCustomerMatch(customer) };
  } catch (error) {
    console.error(`[orders] customer lookup for store ${member.store.id} failed:`, describeError(error));
    return { ok: false, message: "We couldn't check this phone number. Please try again." };
  }
}

// Staff of the store see the full number.
function toCustomerMatch(customer: CustomerRecord): CustomerMatch {
  return { id: customer.id, name: customer.name, phone: formatPhone(customer.phone), email: customer.email };
}

// "customer.name", "serviceLines.0.quantity": the first message per field.
function toFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join(".") || "form";
    fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

// The error's class and Prisma code only, never the message (which can repeat
// the query's values, such as a phone number).
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}`;
}
