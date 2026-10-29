import { SidebarContent } from "./SidebarContent";
import type { NavCounts, WorkspaceMember } from "./types";

// Desktop only; below lg the same contents open from MobileNav.
export function Sidebar({ member, navCounts }: { member: WorkspaceMember; navCounts: NavCounts }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-card lg:block print:hidden">
      <SidebarContent member={member} navCounts={navCounts} />
    </aside>
  );
}
