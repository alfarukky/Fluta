"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { joinWithExistingAccount } from "@/actions/invitations";
import { FormAlert } from "@/components/auth/FormAlert";
import { Button } from "@/components/ui/button";
import { rememberSignInEmail } from "@/lib/sign-in-email";

import { AcceptedNotice } from "./AcceptedNotice";

// The invited email already has an account: join without signing in, then
// open sign-in with the email filled in (passed through sessionStorage, never
// the URL), unless someone else is signed in on this browser.
export function JoinStoreButton({ token, storeName }: { token: string; storeName: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [joinedAs, setJoinedAs] = useState<string | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function join() {
    setMessage(null);
    startTransition(async () => {
      const result = await joinWithExistingAccount(token);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      if (result.someoneElseSignedIn) {
        setJoinedAs(result.email);
        return;
      }
      rememberSignInEmail(result.email);
      router.push("/sign-in");
    });
  }

  if (joinedAs) return <AcceptedNotice heading={`You've joined ${storeName}.`} email={joinedAs} />;

  return (
    <div className="flex flex-col gap-form">
      {message && <FormAlert>{message}</FormAlert>}
      <Button size="lg" className="w-full" onClick={join} disabled={pending}>
        {pending && <LoaderCircleIcon className="animate-spin" data-icon="inline-start" aria-hidden />}
        {pending ? "Joining…" : `Join ${storeName}`}
      </Button>
    </div>
  );
}
