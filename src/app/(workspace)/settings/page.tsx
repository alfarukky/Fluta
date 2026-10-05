import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireStoreMember } from "@/server/auth/session";

export const metadata: Metadata = { title: "Settings · Fluta" };

export default async function SettingsPage() {
  const member = await requireStoreMember({ role: "OWNER" });
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  return <ComingSoon href="/settings" />;
}
