import type { Metadata } from "next";
import Link from "next/link";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { ForgotPasswordForm } from "@/components/password/ForgotPasswordForm";
import { SIGN_IN_PATH } from "@/server/auth/session";

export const metadata: Metadata = { title: "Forgot password · Fluta" };

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      eyebrow="Store workspace"
      title="Forgot your password?"
      description="Enter your account's email and we'll send you a link to choose a new password. The link expires in 1 hour."
    >
      <ForgotPasswordForm />
      <Link href={SIGN_IN_PATH} className="type-label text-center text-primary underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </AuthPageShell>
  );
}
