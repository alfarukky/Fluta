import { FormAlert } from "@/components/auth/FormAlert";

// After accepting while someone else is signed in on this browser: their
// session is left alone, so the invited person signs in themselves later.
export function AcceptedNotice({ heading, email }: { heading: string; email: string }) {
  return (
    <div className="flex flex-col gap-form">
      <FormAlert tone="success">{`${heading} Sign in as ${email}`}</FormAlert>
      <p className="type-body-sm text-muted-foreground">
        Someone else is signed in on this browser, so they stay signed in. To sign in as{" "}
        <span className="font-medium break-all text-foreground">{email}</span>, sign out first or open a private
        window.
      </p>
    </div>
  );
}
