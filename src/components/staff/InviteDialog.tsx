"use client";

import { useState, useTransition, type FormEvent } from "react";

import { inviteStaff, resendInvitation, type InvitationActionResult } from "@/actions/staff";
import { describedBy, FormField } from "@/components/settings/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { InviteLinkPanel } from "./InviteLinkPanel";

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // A pending invitation was resent from here: old ID → replacement's ID.
  onResent: (oldId: string, newId: string) => void;
}

type Sent = Extract<InvitationActionResult, { ok: true }>;

// Invite by email (always as Staff). Afterwards the dialog shows the link once.
// Rendered with a fresh key each time it opens, so nothing carries over.
export function InviteDialog({ open, onOpenChange, onResent }: InviteDialogProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [pending, startTransition] = useTransition();

  function show(result: InvitationActionResult) {
    if (result.ok) {
      setSent(result);
      return;
    }
    setError(result.fieldErrors?.email ?? result.message);
    setPendingInvitationId(result.pendingInvitationId ?? null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("email", email);
    setError(null);
    setPendingInvitationId(null);
    startTransition(async () => show(await inviteStaff(formData)));
  }

  function resendPending() {
    if (!pendingInvitationId) return;
    const id = pendingInvitationId;
    setError(null);
    setPendingInvitationId(null);
    startTransition(async () => {
      const result = await resendInvitation(id);
      if (result.ok) onResent(id, result.invitationId);
      show(result);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{sent ? "Invitation ready" : "Invite staff"}</DialogTitle>
          <DialogDescription>
            {sent
              ? "Share this link with the person you invited. They'll set their name and password."
              : "They'll get an email with a private link to join your store as staff."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <>
            <InviteLinkPanel inviteUrl={sent.inviteUrl} message={sent.message} emailSent={sent.emailSent} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-form" noValidate>
            <FormField id="invite-email" label="Email" error={error ?? undefined}>
              <Input
                id="invite-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={describedBy("invite-email", undefined, error ?? undefined)}
                required
                autoFocus
              />
            </FormField>
            <p className="type-caption text-muted-foreground">Role: Staff</p>
            {pendingInvitationId && (
              <Button type="button" variant="outline" onClick={resendPending} disabled={pending}>
                Resend invitation
              </Button>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || email.trim() === ""}>
                {pending ? "Sending…" : "Send invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
