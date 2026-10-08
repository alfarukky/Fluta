"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { acceptInvitation } from "@/actions/invitations";
import { FormAlert } from "@/components/auth/FormAlert";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rememberSignInEmail } from "@/lib/sign-in-email";
import { MIN_PASSWORD_LENGTH } from "@/schemas/users";

import { AcceptedNotice } from "./AcceptedNotice";

// A new account for the invited email: name and password. On success the
// action signs the person in and opens the workspace.
export function NewAccountForm({ token }: { token: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [createdFor, setCreatedFor] = useState<string | null>(null);
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await acceptInvitation(token, formData);
      // Success redirects to the workspace, unless someone else is signed in
      // in this browser: then their session is left alone.
      if (!result) return;
      if (result.ok) {
        if (result.someoneElseSignedIn) {
          setCreatedFor(result.email);
          return;
        }
        rememberSignInEmail(result.email);
        router.push("/sign-in");
        return;
      }
      setMessage(result.message);
      setFieldErrors(result.fieldErrors ?? {});
    });
  }

  if (createdFor) return <AcceptedNotice heading="Account created." email={createdFor} />;

  const hint = `At least ${MIN_PASSWORD_LENGTH} characters`;
  return (
    <form onSubmit={submit} className="flex flex-col gap-form" noValidate>
      {message && <FormAlert>{message}</FormAlert>}
      <FormField id="name" label="Your name" error={fieldErrors.name}>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          aria-invalid={Boolean(fieldErrors.name) || undefined}
          aria-describedby={describedBy("name", undefined, fieldErrors.name)}
        />
      </FormField>
      <FormField id="password" label="Password" hint={hint} error={fieldErrors.password}>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={Boolean(fieldErrors.password) || undefined}
          aria-describedby={describedBy("password", hint, fieldErrors.password)}
        />
      </FormField>
      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending && <LoaderCircleIcon className="animate-spin" data-icon="inline-start" aria-hidden />}
        {pending ? "Joining…" : "Join store"}
      </Button>
    </form>
  );
}
