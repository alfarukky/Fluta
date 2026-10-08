import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { StaffManagement } from "@/components/staff/StaffManagement";
import type { StaffRow } from "@/components/staff/staff-rows";
import { formatCalendarDate, getLocalDateKey } from "@/lib/time";
import { requireStoreMember } from "@/server/auth/session";
import { getStaffList } from "@/server/services/staff";

export const metadata: Metadata = { title: "Staff · Fluta" };

export default async function StaffPage() {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  const entries = await getStaffList(member.store.id);
  const rows = entries.map(({ date, ...entry }): StaffRow => {
    const day = formatCalendarDate(getLocalDateKey(new Date(date), member.store.timeZone));
    return { ...entry, dateLabel: `${entry.kind === "member" ? "Joined" : "Invited"} ${day}` };
  });

  return <StaffManagement rows={rows} />;
}
