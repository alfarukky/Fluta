import type { Metadata } from "next";
import Link from "next/link";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { RESET_LINK_INVALID_MESSAGE, ResetPasswordForm } from "@/components/password/ResetPasswordForm";

// Better Auth's emailed link redirects here with ?token=… (or ?error=… when
// the link is invalid or expired). The token is never indexed or sent on as
// a referrer (next.config.ts also sets the headers).
export const metadata: Metadata = {
  title: "Choose a new password · Fluta",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  const usable = typeof token === "string" && token.length > 0 && !error;

  if (!usable) {
    return (
      <AuthPageShell title="Reset link not valid" description={RESET_LINK_INVALID_MESSAGE}>
        <Link href="/forgot-password" className="type-label text-primary underline-offset-4 hover:underline">
          Request a new link
        </Link>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell eyebrow="Store workspace" title="Choose a new password" description="You'll be signed out on every device.">
      <ResetPasswordForm token={token} />
    </AuthPageShell>
  );
}
