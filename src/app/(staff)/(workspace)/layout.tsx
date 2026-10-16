import { AccessDenied } from "@/components/auth/AccessDenied";
import { AppShell } from "@/components/workspace/AppShell";
import { requireStoreMember } from "@/server/auth/session";
import { getOpenOrderCount } from "@/server/services/orders";

// Every workspace page must call requireStoreMember itself too: this check
// doesn't stop the page from rendering. Both share one lookup per request.
// Riders get the shell (with only Deliveries in the menu); every page except
// Deliveries refuses them itself, because requireStoreMember does by default.
export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const member = await requireStoreMember({ allowRider: true });
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  return (
    <AppShell
      member={{
        userName: member.user.name,
        userEmail: member.user.email,
        role: member.membership.role,
        storeName: member.store.name,
      }}
      // Loaded once per request; it updates on the next page load.
      navCounts={member.membership.role === "RIDER" ? {} : { "/orders": await getOpenOrderCount(member.store.id) }}
      timeZone={member.store.timeZone}
      now={new Date()}
    >
      {children}
    </AppShell>
  );
}
