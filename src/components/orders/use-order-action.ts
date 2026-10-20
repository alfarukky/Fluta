"use client";

import { useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";

type ActionResult = { ok: true; message: string } | { ok: false; message: string };

// Runs an order action from the detail page. Buttons stay disabled until the
// refreshed page arrives, and the success toast waits for it too (the
// action's result comes back before the refreshed page). A failure shows its
// reason at once.
export function useOrderAction() {
  const [pending, startTransition] = useTransition();
  const successMessage = useRef<string | null>(null);

  useEffect(() => {
    if (pending || !successMessage.current) return;
    toast.success(successMessage.current);
    successMessage.current = null;
  }, [pending]);

  // The refreshed page can remove the buttons themselves (a banner that goes
  // away once the quote is approved): the message still shows.
  useEffect(
    () => () => {
      if (successMessage.current) toast.success(successMessage.current);
      successMessage.current = null;
    },
    [],
  );

  // `onFailure` lets a form show some failures itself (under a field, or a
  // question to confirm): when it returns true, no error toast is shown.
  function run<Result extends ActionResult>(
    action: () => Promise<Result>,
    onDone?: () => void,
    onFailure?: (result: Extract<Result, { ok: false }>) => boolean,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        successMessage.current = result.message;
        onDone?.();
      } else if (!onFailure?.(result as Extract<Result, { ok: false }>)) {
        toast.error(result.message);
      }
    });
  }

  return { pending, run };
}
