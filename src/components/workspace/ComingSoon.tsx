import { EmptyState } from "@/components/shared/EmptyState";

import { getNavItem, type NavHref } from "./nav-items";
import { PageHeader } from "./PageHeader";

// Placeholder for a workspace page whose feature isn't built yet. The page
// itself still checks access before rendering this.
export function ComingSoon({ href }: { href: NavHref }) {
  const { label, icon } = getNavItem(href);

  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section">
      <PageHeader title={label} />
      <EmptyState
        icon={icon}
        title="Coming soon"
        description={`${label} isn't ready yet. It will appear here as soon as it's built.`}
      />
    </main>
  );
}
