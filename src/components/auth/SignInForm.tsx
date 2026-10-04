"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const TOO_MANY_REQUESTS = 429;

// One message for every credential failure, so the form never reveals
// whether an email has an account.
export const INVALID_CREDENTIALS_MESSAGE = "Email or password is incorrect";
const RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Wait a few minutes and try again.";
const UNEXPECTED_MESSAGE = "Something went wrong. Check your connection and try again.";

export function SignInForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { error: signInError } = await authClient.signIn.email({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      if (signInError) {
        setError(signInError.status === TOO_MANY_REQUESTS ? RATE_LIMITED_MESSAGE : INVALID_CREDENTIALS_MESSAGE);
        setPending(false);
        return;
      }
      // The sign-in page sends a signed-in user to their home page.
      router.refresh();
    } catch {
      setError(UNEXPECTED_MESSAGE);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-form">
      {error && (
        <p role="alert" className="type-body-sm rounded-lg border border-error/30 bg-error/10 px-3.5 py-3 text-error">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@yourstore.com"
          required
          aria-invalid={error === INVALID_CREDENTIALS_MESSAGE || undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            required
            className="pr-16"
            aria-invalid={error === INVALID_CREDENTIALS_MESSAGE || undefined}
          />
          <Button
            type="button"
            variant="ghost"
            className="absolute inset-y-0 right-0 h-11 px-4 text-xs text-muted-foreground hover:bg-transparent"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((shown) => !shown)}
          >
            {showPassword ? "Hide" : "Show"}
          </Button>
        </div>
      </div>
      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending && <LoaderCircleIcon className="animate-spin" data-icon="inline-start" aria-hidden />}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
