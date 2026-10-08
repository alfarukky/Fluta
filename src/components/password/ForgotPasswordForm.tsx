"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { FormAlert } from "@/components/auth/FormAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { normalizeEmail } from "@/lib/email-address";

const TOO_MANY_REQUESTS = 429;

// The same answer whether or not the email has an account.
export const RESET_REQUESTED_MESSAGE = "If an account exists for this email, we've sent a reset link.";
const RATE_LIMITED_MESSAGE = "Too many reset requests. Wait a few minutes and try again.";
const UNEXPECTED_MESSAGE = "Something went wrong. Check your connection and try again.";

// Posts to Better Auth's /request-password-reset endpoint (rate limited).
export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = normalizeEmail(String(new FormData(event.currentTarget).get("email") ?? ""));
    setPending(true);
    setResult(null);
    try {
      const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
      setResult(
        error?.status === TOO_MANY_REQUESTS
          ? { tone: "error", message: RATE_LIMITED_MESSAGE }
          : { tone: "success", message: RESET_REQUESTED_MESSAGE },
      );
    } catch {
      setResult({ tone: "error", message: UNEXPECTED_MESSAGE });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-form">
      {result && <FormAlert tone={result.tone}>{result.message}</FormAlert>}
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
        />
      </div>
      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending && <LoaderCircleIcon className="animate-spin" data-icon="inline-start" aria-hidden />}
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
