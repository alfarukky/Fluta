import type { Metadata } from "next";
import Link from "next/link";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { FormAlert } from "@/components/auth/FormAlert";
import { JoinStoreButton } from "@/components/invitations/JoinStoreButton";
import { NewAccountForm } from "@/components/invitations/NewAccountForm";
import { ROLE_LABELS } from "@/components/workspace/nav-items";
import { INVITATION_MESSAGES } from "@/schemas/staff";
import { SIGN_IN_PATH } from "@/server/auth/session";
import { invitedEmailCantJoin, findUserIdByEmail } from "@/server/data/invitations";
import { findUsableInvitation } from "@/server/services/invitations";

// Public: the private link is the credential, and what the page offers never
// depends on who is signed in in this browser. Never indexed, and the token
// in the URL is never sent on as a referrer (next.config.ts also sets
// Referrer-Policy and Cache-Control: no-store for /invite/*).
export const metadata: Metadata = {
  title: "Join your store · Fluta",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitationPage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitation = await findUsableInvitation(token);

  if (!invitation) {
    return (
      <AuthPageShell title="Invitation not valid" description={INVITATION_MESSAGES.invalid}>
        <Link href={SIGN_IN_PATH} className="type-label text-primary underline-offset-4 hover:underline">
          Go to sign in
        </Link>
      </AuthPageShell>
    );
  }

  const storeName = invitation.store.name;
  return (
    <AuthPageShell
      eyebrow="Store invitation"
      title={`Join ${storeName}`}
      description="You've been invited to the store's Fluta workspace."
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl border border-border bg-card p-card">
        <dt className="type-body-sm text-muted-foreground">Store</dt>
        <dd className="type-label break-words text-foreground">{storeName}</dd>
        <dt className="type-body-sm text-muted-foreground">Role</dt>
        <dd className="type-label text-foreground">{ROLE_LABELS[invitation.role]}</dd>
        <dt className="type-body-sm text-muted-foreground">Email</dt>
        <dd className="type-label break-all text-foreground">{invitation.email}</dd>
      </dl>
      <InvitationAction token={token} email={invitation.email} storeName={storeName} />
    </AuthPageShell>
  );
}

async function InvitationAction({ token, email, storeName }: { token: string; email: string; storeName: string }) {
  if (await invitedEmailCantJoin(email)) return <FormAlert>{INVITATION_MESSAGES.activeElsewhere}</FormAlert>;

  if (await findUserIdByEmail(email)) {
    return (
      <div className="flex flex-col gap-form">
        <p className="type-body-sm text-muted-foreground">
          This email already has a Fluta account. Join the store, then sign in with it.
        </p>
        <JoinStoreButton token={token} storeName={storeName} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-form">
      <p className="type-body-sm text-muted-foreground">Set your name and a password to finish.</p>
      <NewAccountForm token={token} />
    </div>
  );
}
