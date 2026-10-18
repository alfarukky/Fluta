import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FoldBackdrop } from "@/components/auth/FoldBackdrop";
import { SignInForm } from "@/components/auth/SignInForm";
import { Logo } from "@/components/brand/Logo";
import { getHomePath, getSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in · Fluta" };

export default async function SignInPage() {
  const session = await getSession();
  if (session) redirect(await getHomePath(session.user.id));

  return (
    <div className="grid flex-1 md:grid-cols-[3fr_4fr]">
      <aside className="relative hidden flex-col justify-between gap-section overflow-hidden bg-primary p-section text-primary-foreground md:flex">
        <FoldBackdrop />
        <Logo tone="reversed" size="lg" className="relative self-start motion-safe:animate-enter" />
        <div className="relative flex max-w-md flex-col gap-4 motion-safe:animate-enter motion-safe:[animation-delay:120ms]">
          <h2 className="type-display">Your laundry business, calmly organised.</h2>
          <p className="type-body opacity-85">
            Orders, pickups, payments and your customers, in one clear workspace.
          </p>
        </div>
        <p className="relative type-caption opacity-70">Built for independent laundry businesses.</p>
      </aside>

      <main className="flex items-center justify-center px-page py-section">
        <div className="flex w-full max-w-md flex-col gap-8">
          <Logo size="lg" className="self-start motion-safe:animate-enter md:hidden" />
          <div className="flex flex-col gap-8 motion-safe:animate-enter motion-safe:[animation-delay:80ms]">
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
        </div>
      </main>
    </div>
  );
}
