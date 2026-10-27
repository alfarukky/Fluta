"use client";

import { BellIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { describeUnread, formatUnreadBadge, NOTIFICATION_POLL_MS } from "@/lib/staff-notifications";
import { cn } from "@/lib/utils";
import type { NotificationItem, OpenedNotificationsResponse, UnreadCountResponse } from "@/types/staff-notifications";

export const COUNT_URL = "/api/v1/notifications";
export const SEEN_URL = "/api/v1/notifications/seen";

type ListState = { status: "idle" | "loading" | "error" } | { status: "ready"; items: NotificationItem[] };

// The unread count, asked for every 30 seconds while the tab is visible (and
// straight away when it becomes visible again). Stops for good once the
// server refuses: signed out, membership ended, or not owner or staff.
function useUnreadCount() {
  const [count, setCount] = useState(0);
  const stopped = useRef(false);

  const refresh = useCallback(async () => {
    if (stopped.current) return;
    try {
      const response = await fetch(COUNT_URL, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        stopped.current = true;
        setCount(0);
        return;
      }
      if (!response.ok) return;
      const body = (await response.json()) as UnreadCountResponse;
      if (typeof body.count === "number") setCount(body.count);
    } catch {
      // Offline for a moment: the next poll tries again.
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null || stopped.current) return;
      void refresh();
      timer = setInterval(() => void refresh(), NOTIFICATION_POLL_MS);
    };
    const pause = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : pause());

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      pause();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { count, setCount };
}

// The workspace top bar's bell, for owners and staff (never riders). Opening
// it marks everything up to that moment seen, for this person only.
export function NotificationBell() {
  const { count, setCount } = useUnreadCount();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ status: "idle" });
  const badge = formatUnreadBadge(count);

  // Screen readers hear about new notifications, not every poll.
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef(0);
  useEffect(() => {
    if (count > previous.current) setAnnouncement(describeUnread(count));
    previous.current = count;
  }, [count]);

  async function openBell() {
    setList({ status: "loading" });
    try {
      const response = await fetch(SEEN_URL, { method: "POST", cache: "no-store" });
      if (!response.ok) {
        setList({ status: "error" });
        return;
      }
      const body = (await response.json()) as OpenedNotificationsResponse;
      setList({ status: "ready", items: body.items });
      setCount(0);
    } catch {
      setList({ status: "error" });
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void openBell();
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="relative size-11 shrink-0 rounded-full p-0" aria-label={describeUnread(count)}>
          <span className="flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
            <BellIcon className="size-4" aria-hidden />
          </span>
          {badge && (
            <span
              aria-hidden
              className="type-caption absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 font-semibold text-primary-foreground"
            >
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <span className="sr-only" aria-live="polite" role="status">
        {announcement}
      </span>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="border-b border-border px-4 py-3">
          <h2 className="type-label text-foreground">Notifications</h2>
        </div>
        <NotificationList list={list} onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({ list, onNavigate }: { list: ListState; onNavigate: () => void }) {
  if (list.status !== "ready") {
    const message = list.status === "error" ? "Notifications couldn't load. Close and try again." : "Loading notifications…";
    return <p className="type-body-sm px-4 py-6 text-muted-foreground">{message}</p>;
  }
  if (list.items.length === 0) {
    return <p className="type-body-sm px-4 py-6 text-muted-foreground">No notifications yet</p>;
  }
  return (
    <ul className="max-h-[min(28rem,70dvh)] overflow-y-auto py-1">
      {list.items.map((item) => (
        <li key={item.id}>
          <Link
            href={item.href}
            onClick={onNavigate}
            className="flex gap-3 px-4 py-3 outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span
              aria-hidden
              className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.isNew ? "bg-primary" : "bg-transparent")}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="type-body-sm text-foreground">
                {item.isNew && <span className="sr-only">New: </span>}
                {item.text}
              </span>
              <span className="type-caption text-muted-foreground">
                {item.orderNumber} · {item.time}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
