import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireStoreMember } from "@/server/auth/session";

export const metadata: Metadata = { title: "Payments · Fluta" };

export default async function PaymentsPage() {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  return <ComingSoon href="/payments" />;
}
