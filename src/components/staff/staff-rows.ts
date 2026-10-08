import type { StaffListEntry, StaffStatus } from "@/types/staff";

// A staff list entry with its date already formatted on the server (in the
// store's time zone), so the server and browser render the same text.
export interface StaffRow extends Omit<StaffListEntry, "date"> {
  // "Joined Mon, 5 Oct 2026" or "Invited Thu, 8 Oct 2026"
  dateLabel: string;
}

export function countStaff(rows: readonly StaffRow[]): number {
  return rows.filter((row) => row.role !== "OWNER").length;
}

// What the page's own actions changed, shown at once instead of waiting for
// the refreshed list (which can arrive seconds later). Without it, acting on
// a row straight after Resend would use the replaced invitation's ID.
export interface StaffChanges {
  // Replaced invitation ID → its replacement (Resend).
  replaced: ReadonlyMap<string, string>;
  // Revoked invitations.
  revoked: ReadonlySet<string>;
  // Membership ID → status after Deactivate or Reactivate.
  statuses: ReadonlyMap<string, StaffStatus>;
}

export const NO_STAFF_CHANGES: StaffChanges = { replaced: new Map(), revoked: new Set(), statuses: new Map() };

export function applyStaffChanges(rows: readonly StaffRow[], changes: StaffChanges): StaffRow[] {
  return rows
    .map((row): StaffRow => {
      if (row.kind === "invitation") {
        const replacement = latestReplacement(row.id, changes.replaced);
        // A resent invitation is pending again, even if it had expired.
        return replacement === row.id ? row : { ...row, id: replacement, status: "INVITED" };
      }
      const status = changes.statuses.get(row.id);
      return status ? { ...row, status } : row;
    })
    .filter((row) => !(row.kind === "invitation" && changes.revoked.has(row.id)));
}

// Resend can be repeated, so follow the chain to the newest invitation.
function latestReplacement(id: string, replaced: ReadonlyMap<string, string>): string {
  let current = id;
  for (let step = 0; step < replaced.size && replaced.has(current); step += 1) current = replaced.get(current)!;
  return current;
}
