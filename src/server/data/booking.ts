import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { STORE_ACCESS_SELECT } from "./access";
import { getPrisma } from "./client";

// The public side of a store, for its booking page, home-screen app, and link
// preview. No session: the store comes only from the slug in the address.
// Only what those pages show (and what getStoreAccess needs) is read. Every
// query about the store's services, areas, and schedule then goes through the
// usual storeId-scoped functions, with this store's ID.

const PUBLIC_STORE_SELECT = {
  ...STORE_ACCESS_SELECT,
  description: true,
  phone: true,
  logoKey: true,
  brandAccentColor: true,
  // Book and pay: a connected store with pay later off (never shown).
  paystackSubaccountCode: true,
  payLaterEnabled: true,
} satisfies Prisma.StoreSelect;

export type PublicStoreRecord = Prisma.StoreGetPayload<{ select: typeof PUBLIC_STORE_SELECT }>;

export async function findPublicStoreBySlug(slug: string): Promise<PublicStoreRecord | null> {
  return getPrisma().store.findUnique({ where: { slug }, select: PUBLIC_STORE_SELECT });
}
