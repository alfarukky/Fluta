"use client";

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyLinkButton } from "@/components/workspace/CopyLinkButton";
import { cn } from "@/lib/utils";
import { INVITATION_VALID_DAYS } from "@/schemas/staff";

interface InviteLinkPanelProps {
  inviteUrl: string;
  message: string;
  emailSent: boolean;
}

// The invite link, shown once after inviting or resending, so it can also be
// shared by WhatsApp. It isn't stored anywhere it could be shown again.
export function InviteLinkPanel({ inviteUrl, message, emailSent }: InviteLinkPanelProps) {
  const Icon = emailSent ? CircleCheckIcon : CircleAlertIcon;
  return (
    <div className="flex flex-col gap-form">
      <p
        role={emailSent ? "status" : "alert"}
        className={cn(
          "type-body-sm flex items-start gap-2 rounded-lg border px-3.5 py-3",
          emailSent ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning",
        )}
      >
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {message}
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-link">Invite link</Label>
        <Input id="invite-link" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
        <p className="type-caption text-muted-foreground">
          Only shown now. It works once and expires in {INVITATION_VALID_DAYS} days. To try it yourself, open it in a
          private window so you stay signed in here.
        </p>
      </div>
      <CopyLinkButton url={inviteUrl} copiedMessage="Invite link copied" className="w-full xs:w-fit" />
    </div>
  );
}
