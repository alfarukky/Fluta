import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { FulfilmentSettings } from "@/components/fulfilment/FulfilmentSettings";
import { describeTimeZone } from "@/lib/time";
import { requireStoreMember } from "@/server/auth/session";
import { loadFulfilmentSettings } from "@/server/services/fulfilment-settings";

export const metadata: Metadata = { title: "Fulfilment · Fluta" };

export default async function FulfilmentPage() {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  const now = new Date();
  const settings = await loadFulfilmentSettings(member.store.id, member.store.timeZone, now);

  return (
    <FulfilmentSettings
      options={{ dropOffEnabled: settings.dropOffEnabled, pickupDeliveryEnabled: settings.pickupDeliveryEnabled }}
      areas={settings.areas}
      schedule={{ activeDays: settings.activeDays, openTime: settings.openTime, closeTime: settings.closeTime }}
      closedDates={settings.closedDates}
      today={settings.today}
      timeZoneLabel={describeTimeZone(member.store.timeZone, now)}
      pickupAvailable={settings.pickupAvailable}
    />
  );
}
