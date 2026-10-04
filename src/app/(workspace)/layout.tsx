import { AccessDenied } from "@/components/auth/AccessDenied";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { Logo } from "@/components/brand/Logo";
import { requireStoreMember } from "@/server/auth/session";

// Placeholder shell until Feature 04 adds the sidebar and top bar. Every
// workspace page must call requireStoreMember itself too: this check doesn't
// stop the page from rendering.
export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const member = await requireStoreMember();
  if (!member.allowed) return <AccessDenied reason={member.reason} />;

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="page-container flex items-center justify-between gap-component py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <span className="type-body-sm truncate text-muted-foreground">{member.store.name}</span>
          </div>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
