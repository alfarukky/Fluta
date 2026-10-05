"use client";

import { useSyncExternalStore } from "react";

import { formatLongDate, getGreeting } from "@/lib/time";

export const GREETING_REFRESH_MS = 5 * 60 * 1000;

// Re-read the clock every few minutes and when the tab is shown again (the
// workspace is often left open all day, or overnight on a sleeping laptop).
function subscribeToClock(onChange: () => void) {
  const interval = setInterval(onChange, GREETING_REFRESH_MS);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onChange);
  };
}

interface TopBarGreetingProps {
  timeZone: string;
  firstName: string;
  // What the server rendered; shown until hydration so the HTML matches.
  serverDate: string;
  serverGreeting: string;
}

// Today's date and "Good morning, {name}" in the store's time zone, kept current.
export function TopBarGreeting({ timeZone, firstName, serverDate, serverGreeting }: TopBarGreetingProps) {
  const date = useSyncExternalStore(
    subscribeToClock,
    () => formatLongDate(new Date(), timeZone),
    () => serverDate,
  );
  const greeting = useSyncExternalStore(
    subscribeToClock,
    () => getGreeting(new Date(), timeZone),
    () => serverGreeting,
  );

  return (
    <div className="min-w-0 flex-1">
      <p className="type-caption truncate text-muted-foreground">{date}</p>
      <p className="type-h3 truncate text-foreground">
        {greeting}, {firstName}
      </p>
    </div>
  );
}
