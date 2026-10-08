import type { ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";

interface AuthPageShellProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}

// The plain centred layout for public account pages (invitation, forgot and
// reset password).
export function AuthPageShell({ eyebrow, title, description, children }: AuthPageShellProps) {
  return (
    <main className="flex flex-1 items-center justify-center px-page py-section">
      <div className="flex w-full max-w-md flex-col gap-8">
        <Logo size="lg" />
        <div className="flex flex-col gap-2">
          {eyebrow && <p className="type-label text-primary">{eyebrow}</p>}
          <h1 className="type-h1">{title}</h1>
          {description && <div className="type-body-sm text-muted-foreground">{description}</div>}
        </div>
        {children}
      </div>
    </main>
  );
}
