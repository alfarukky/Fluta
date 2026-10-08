"use client";

import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { FormAlert } from "@/components/auth/FormAlert";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH, passwordSchema } from "@/schemas/users";

const TOO_MANY_REQUESTS = 429;

export const RESET_LINK_INVALID_MESSAGE = "This reset link is no longer valid. Request a new one.";
const RATE_LIMITED_MESSAGE = "Too many attempts. Wait a few minutes and try again.";
const UNEXPECTED_MESSAGE = "Something went wrong. Check your connection and try again.";

// Posts to Better Auth's /reset-password endpoint, which checks the length
// again (minPasswordLength) and signs the account out everywhere.
export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");
    setError(null);
    setFieldError(null);
    const checked = passwordSchema.safeParse(newPassword);
    if (!checked.success) {
      setFieldError(checked.error.issues[0]?.message ?? "Choose another password");
      return;
    }

    setPending(true);
    try {
      const { error: resetError } = await authClient.resetPassword({ newPassword, token });
      if (!resetError) {
        setDone(true);
        return;
      }
      if (resetError.status === TOO_MANY_REQUESTS) setError(RATE_LIMITED_MESSAGE);
      else if (resetError.code === "PASSWORD_TOO_SHORT" || resetError.code === "PASSWORD_TOO_LONG") {
        setFieldError(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
      } else setError(RESET_LINK_INVALID_MESSAGE);
    } catch {
      setError(UNEXPECTED_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-form">
        <FormAlert tone="success">Your password has been changed. Sign in with your new password.</FormAlert>
        <Button asChild size="lg" className="w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  const hint = `At least ${MIN_PASSWORD_LENGTH} characters`;
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-form" noValidate>
      {error && <FormAlert>{error}</FormAlert>}
      <FormField id="password" label="New password" hint={hint} error={fieldError ?? undefined}>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={Boolean(fieldError) || undefined}
          aria-describedby={describedBy("password", hint, fieldError ?? undefined)}
        />
      </FormField>
      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending && <LoaderCircleIcon className="animate-spin" data-icon="inline-start" aria-hidden />}
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
