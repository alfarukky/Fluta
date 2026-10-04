import { AccessDenied } from "@/components/auth/AccessDenied";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { Logo } from "@/components/brand/Logo";
import { requireFlutaAdmin } from "@/server/auth/session";

// Every admin page must call requireFlutaAdmin itself too: this check
// doesn't stop the page from rendering.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireFlutaAdmin();
  if (!admin.allowed) return <AccessDenied reason={admin.reason} />;

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="page-container flex items-center justify-between gap-component py-3">
          <Logo />
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
