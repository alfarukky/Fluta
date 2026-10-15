"use client";

import { SmartphoneIcon, XIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

// The browser's install prompt (Chrome on Android). Not in TypeScript's DOM types.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface AddToHomeScreenHintProps {
  slug: string;
  storeName: string;
}

// A small hint, on phones only, to add this store's page to the home screen.
// Android gets the browser's own install prompt when it offers one. iPhone has
// no prompt, so it gets the steps. Once dismissed (or installed) it stays
// hidden: remembered in this phone's browser storage, which may be missing
// (private browsing, some in-app browsers), in which case it just shows again.
export function AddToHomeScreenHint({ slug, storeName }: AddToHomeScreenHintProps) {
  const storageKey = `fluta:home-screen-hint-dismissed:${slug}`;
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Read once in the browser (never on the server, so the first render matches).
  const eligible = useSyncExternalStore(
    subscribeToNothing,
    () => isPhone() && !isInstalled() && !readDismissed(storageKey),
    () => false,
  );
  const iPhone = useSyncExternalStore(subscribeToNothing, isIPhone, () => false);

  useEffect(() => {
    if (!eligible || iPhone) return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      writeDismissed(storageKey);
      setDismissed(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [eligible, iPhone, storageKey]);

  if (!eligible || dismissed || (!iPhone && !installPrompt)) return null;

  function dismiss() {
    writeDismissed(storageKey);
    setDismissed(true);
  }

  async function install(event: InstallPromptEvent) {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") writeDismissed(storageKey);
    setDismissed(true);
  }

  return (
    <aside
      aria-label="Add to Home Screen"
      className="sticky bottom-0 z-10 mt-auto border-t border-border bg-card px-page pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg"
    >
      <div className="mx-auto flex max-w-xl items-start gap-3">
        <SmartphoneIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="type-body-sm text-card-foreground">
            {iPhone
              ? `Add ${storeName} to your home screen: tap Share, then Add to Home Screen.`
              : `Add ${storeName} to your home screen to book again in one tap.`}
          </p>
          {!iPhone && installPrompt && (
            <Button type="button" variant="secondary" className="self-start" onClick={() => install(installPrompt)}>
              Add to Home Screen
            </Button>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss">
          <XIcon aria-hidden />
        </Button>
      </div>
    </aside>
  );
}

function subscribeToNothing(): () => void {
  return () => {};
}

function isPhone(): boolean {
  return window.matchMedia("(pointer: coarse) and (max-width: 767px)").matches;
}

function isInstalled(): boolean {
  const iosStandalone = "standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true;
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone;
}

// iPhone and iPod (iPads count as desktops here).
function isIPhone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Storage unavailable: the hint simply may show again next time.
  }
}
