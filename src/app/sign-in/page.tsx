import type { Metadata } from "next";
import { ShirtIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/SignInForm";
import { Logo } from "@/components/brand/Logo";
import { getHomePath, getSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in · Fluta" };

export default async function SignInPage() {
  const session = await getSession();
  if (session) redirect(await getHomePath(session.user.id));

  return (
    <div className="grid flex-1 md:grid-cols-[3fr_4fr]">
      <aside className="hidden flex-col justify-between gap-section bg-primary p-section text-primary-foreground md:flex">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <ShirtIcon className="size-5" aria-hidden />
          </span>
          <Logo className="text-primary-foreground" />
        </div>
        <div className="flex max-w-md flex-col gap-4">
          <p className="type-label text-accent">Your store, beautifully managed.</p>
          <h2 className="type-display">A calmer way to run your laundry store.</h2>
          <p className="type-body opacity-85">
            Keep your store identity, customer experience, and daily work in one clear workspace.
          </p>
        </div>
        <p className="type-caption opacity-70">Built for independent laundry businesses.</p>
      </aside>

      <main className="flex items-center justify-center px-page py-section">
        <div className="flex w-full max-w-md flex-col gap-8">
          <Logo size="lg" className="md:hidden" />
          <div className="flex flex-col gap-2">
            <p className="type-label text-primary">Store workspace</p>
            <h1 className="type-h1">Welcome back</h1>
            <p className="type-body-sm text-muted-foreground">Sign in to manage your store workspace.</p>
          </div>
          <SignInForm />
          <p className="type-caption text-center text-muted-foreground">
            Use the email address associated with your Fluta store account.
          </p>
        </div>
      </main>
    </div>
  );
}
