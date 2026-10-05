import { BellIcon } from "lucide-react";
import type { ReactNode } from "react";

import { getFirstName } from "@/lib/names";
import { formatLongDate, getGreeting } from "@/lib/time";

import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { TopBarGreeting } from "./TopBarGreeting";
import type { WorkspaceMember } from "./types";
import { UserMenu } from "./UserMenu";

interface AppShellProps {
  member: WorkspaceMember;
  // The store's IANA time zone; the date and greeting use it, not the server's.
  timeZone: string;
  now: Date;
  children: ReactNode;
}

// Sidebar (desktop), top bar, and the page. Pages render their own <main>.
export function AppShell({ member, timeZone, now, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-1">
      <a
        href="#content"
        className="type-label sr-only z-50 rounded-md bg-card px-4 py-2 text-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-[3px] focus:ring-ring/50"
      >
        Skip to content
      </a>
      <Sidebar member={member} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background">
          <div className="flex h-16 items-center gap-2 px-page md:gap-3">
            <MobileNav member={member} />
            <TopBarGreeting
              timeZone={timeZone}
              firstName={getFirstName(member.userName)}
              serverDate={formatLongDate(now, timeZone)}
              serverGreeting={getGreeting(now, timeZone)}
            />
            {/* Display only until notifications exist. */}
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
            >
              <BellIcon className="size-4" />
            </span>
            <UserMenu member={member} />
          </div>
        </header>

        <div id="content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          {children}
        </div>
      </div>
    </div>
  );
}
