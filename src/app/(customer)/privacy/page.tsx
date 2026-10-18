import type { Metadata } from "next";
import { connection } from "next/server";

import { Logo } from "@/components/brand/Logo";
import { getServerEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Privacy · Fluta" };

// Fluta's privacy notice, linked from every customer page. Its wording comes
// from the project owner; until then it shows only where to ask.
export default async function PrivacyPage() {
  // Rendered per request, so the build needs no secrets.
  await connection();
  const contact = getServerEnv().FLUTA_ALERT_EMAIL;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-page py-section text-foreground">
      <Logo size="sm" className="self-start" />
      <h1 className="type-h1">Privacy</h1>
      <p className="type-body text-muted-foreground">
        Our privacy notice is coming soon. Contact us at{" "}
        <a href={`mailto:${contact}`} className="text-primary underline underline-offset-4">
          {contact}
        </a>{" "}
        with any questions.
      </p>
    </main>
  );
}
