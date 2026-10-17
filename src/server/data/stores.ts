import "server-only";

import type { CommunicationSetting, StoreBranding, StoreProfile } from "@/schemas/store-settings";

import { getPrisma } from "./client";

// Store profile and branding, always for one store: the caller's storeId comes
// from the membership (requireStoreMember), never from the request.

export async function getStoreSettings(storeId: string) {
  return getPrisma().store.findUniqueOrThrow({
    where: { id: storeId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      addressText: true,
      phone: true,
      email: true,
      logoKey: true,
      brandPrimaryColor: true,
      brandAccentColor: true,
    },
  });
}

export async function updateStoreProfile(storeId: string, profile: StoreProfile): Promise<void> {
  await getPrisma().store.update({
    where: { id: storeId },
    data: {
      name: profile.name,
      description: profile.description,
      addressText: profile.address,
      phone: profile.phone,
      email: profile.email,
    },
  });
}

export async function updateStoreBranding(storeId: string, branding: StoreBranding): Promise<void> {
  await getPrisma().store.update({
    where: { id: storeId },
    data: { brandPrimaryColor: branding.primaryColor, brandAccentColor: branding.accentColor },
  });
}

// The owner's communication switches. Read when a message is queued, so a
// change never affects messages already queued.
const COMMUNICATION_SELECT = { smsEnabled: true, emailCopiesEnabled: true, whatsappContactEnabled: true } as const;

export type CommunicationSettings = Record<CommunicationSetting, boolean>;

export async function findStoreCommunicationSettings(storeId: string): Promise<CommunicationSettings | null> {
  return getPrisma().store.findUnique({ where: { id: storeId }, select: COMMUNICATION_SELECT });
}

export async function updateStoreCommunicationSetting(
  storeId: string,
  setting: CommunicationSetting,
  enabled: boolean,
): Promise<CommunicationSettings> {
  return getPrisma().store.update({ where: { id: storeId }, data: { [setting]: enabled }, select: COMMUNICATION_SELECT });
}

// Sets (or clears) the logo key and returns the one it replaced, so the caller
// can delete that file. The row is locked so two uploads at once can't both
// read the same previous key and leave a file behind.
export async function replaceStoreLogoKey(storeId: string, logoKey: string | null): Promise<string | null> {
  return getPrisma().$transaction(async (tx) => {
    const [current] = await tx.$queryRaw<{ logoKey: string | null }[]>`
      SELECT "logoKey" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
    if (!current) throw new Error("Store not found");
    await tx.store.update({ where: { id: storeId }, data: { logoKey } });
    return current.logoKey;
  });
}
