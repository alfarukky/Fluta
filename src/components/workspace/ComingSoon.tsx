import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/EmptyState";

import { getNavItem, type NavHref } from "./nav-items";
import { PageHeader } from "./PageHeader";

// Placeholder for a workspace page whose feature isn't built yet. The page
// itself still checks access before rendering this.
// `actions` are buttons for the parts of the page that already work.
export function ComingSoon({ href, actions }: { href: NavHref; actions?: ReactNode }) {
  const { label, icon } = getNavItem(href);

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader title={label} actions={actions} />
      <EmptyState
        icon={icon}
        title="Coming soon"
        description={`${label} isn't ready yet. It will appear here as soon as it's built.`}
      />
    </main>
  );
}
