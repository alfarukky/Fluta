import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { requireStoreMember } from "@/server/auth/session";

export const metadata: Metadata = { title: "Overview · Fluta" };

// Placeholder until Feature 04.
export default async function OverviewPage() {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  return (
    <main className="page-container flex flex-col gap-2 py-section">
      <h1 className="type-h1">Overview</h1>
      <p className="type-body text-muted-foreground">
        Signed in to {member.store.name} as {member.user.name} ({member.membership.role === "OWNER" ? "Owner" : "Staff"}).
      </p>
    </main>
  );
}
