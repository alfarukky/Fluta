import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";
import { requireFlutaAdmin } from "@/server/auth/session";

export const metadata: Metadata = { title: "Fluta admin" };

// Placeholder until the admin console is built.
export default async function AdminPage() {
  const admin = await requireFlutaAdmin();
  if (!admin.allowed) return <AccessDenied reason={admin.reason} />;

  return (
    <main className="page-container flex flex-col gap-2 py-section">
      <h1 className="type-h1">Fluta admin</h1>
      <p className="type-body text-muted-foreground">Signed in as {admin.user.name}.</p>
    </main>
  );
}
