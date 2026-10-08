"use client";

import { UserPlusIcon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  deactivateStaff,
  reactivateStaff,
  resendInvitation,
  revokeInvitation,
  type InvitationActionResult,
} from "@/actions/staff";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/workspace/PageHeader";

import { InviteDialog } from "./InviteDialog";
import { InviteLinkPanel } from "./InviteLinkPanel";
import { applyStaffChanges, countStaff, NO_STAFF_CHANGES, type StaffChanges, type StaffRow } from "./staff-rows";
import { StaffCards, StaffTable, type StaffAction } from "./StaffList";

interface StaffManagementProps {
  // From the server, refreshed after every change (the actions revalidate the page).
  rows: StaffRow[];
}

type Sent = Extract<InvitationActionResult, { ok: true }>;

export function StaffManagement({ rows: listed }: StaffManagementProps) {
  const [invite, setInvite] = useState({ open: false, key: 0 });
  const [resent, setResent] = useState<Sent | null>(null);
  const [confirming, setConfirming] = useState<StaffRow | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [changes, setChanges] = useState<StaffChanges>(NO_STAFF_CHANGES);
  const router = useRouter();

  // Each action's result is shown at once; the refreshed list can take a few
  // seconds, and acting on a row before then must use the current IDs.
  const rows = useMemo(() => applyStaffChanges(listed, changes), [listed, changes]);
  function replaced(oldId: string, newId: string) {
    setChanges((current) => ({ ...current, replaced: new Map(current.replaced).set(oldId, newId) }));
  }
  function revoked(id: string) {
    setChanges((current) => ({ ...current, revoked: new Set(current.revoked).add(id) }));
  }
  function statusChanged(id: string, status: "ACTIVE" | "DEACTIVATED") {
    setChanges((current) => ({ ...current, statuses: new Map(current.statuses).set(id, status) }));
  }

  async function withBusy(id: string, work: () => Promise<void>) {
    setBusyIds((current) => new Set(current).add(id));
    try {
      await work();
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  // A refusal can mean the list is out of date (someone else changed it) or
  // this browser is now signed in as someone else (an invite link opened in
  // another tab): reload the page so it shows what's true now.
  function refused(message: string) {
    toast.error(message);
    router.refresh();
  }

  function openInvite() {
    setInvite((current) => ({ open: true, key: current.key + 1 }));
  }

  function handleAction(row: StaffRow, action: StaffAction) {
    switch (action) {
      case "deactivate":
        setConfirming(row);
        return;
      case "reactivate":
        void withBusy(row.id, async () => {
          const result = await reactivateStaff(row.id);
          if (!result.ok) {
            refused(result.message);
            return;
          }
          statusChanged(row.id, "ACTIVE");
          toast.success(`${row.name ?? row.email} can use the workspace again`);
        });
        return;
      case "resend":
        void withBusy(row.id, async () => {
          const result = await resendInvitation(row.id);
          if (!result.ok) {
            refused(result.message);
            return;
          }
          replaced(row.id, result.invitationId);
          setResent(result);
        });
        return;
      case "revoke":
        void withBusy(row.id, async () => {
          const result = await revokeInvitation(row.id);
          if (!result.ok) {
            refused(result.message);
            return;
          }
          revoked(row.id);
          toast.success(`Invitation for ${row.email} revoked`);
        });
        return;
    }
  }

  function confirmDeactivate() {
    const row = confirming;
    if (!row) return;
    setConfirming(null);
    void withBusy(row.id, async () => {
      const result = await deactivateStaff(row.id);
      if (!result.ok) {
        refused(result.message);
        return;
      }
      statusChanged(row.id, "DEACTIVATED");
      toast.success(`${row.name ?? row.email} deactivated and signed out`);
    });
  }

  const inviteButton = (
    <Button onClick={openInvite}>
      <UserPlusIcon data-icon="inline-start" aria-hidden />
      Invite staff
    </Button>
  );
  const hasStaff = countStaff(rows) > 0;

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <div className="flex flex-col gap-section">
        <PageHeader
          title="Staff"
          description="Invite staff, see who has access, and deactivate anyone who no longer works with you."
          actions={hasStaff ? inviteButton : undefined}
        />
        <SettingsNav />
      </div>

      <section aria-label="Staff list" className="flex flex-col gap-component">
        <StaffTable rows={rows} busyIds={busyIds} onAction={handleAction} />
        <StaffCards rows={rows} busyIds={busyIds} onAction={handleAction} />
        {!hasStaff && (
          <EmptyState
            icon={UsersIcon}
            title="No staff yet"
            description="Invite the people who work at your store so they can take orders and update them."
            action={inviteButton}
          />
        )}
      </section>

      <InviteDialog
        key={invite.key}
        open={invite.open}
        onOpenChange={(open) => setInvite((current) => ({ ...current, open }))}
        onResent={replaced}
      />

      <Dialog open={resent !== null} onOpenChange={(open) => !open && setResent(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New invitation ready</DialogTitle>
            <DialogDescription>The previous link no longer works. Share this one instead.</DialogDescription>
          </DialogHeader>
          {resent && <InviteLinkPanel inviteUrl={resent.inviteUrl} message={resent.message} emailSent={resent.emailSent} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResent(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate {confirming?.name ?? "this staff member"}?</DialogTitle>
            <DialogDescription>
              They&apos;ll be signed out straight away and won&apos;t be able to use the workspace. Their orders and
              history stay as they are, and you can reactivate them later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeactivate}>
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
