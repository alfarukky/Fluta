"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import type { TrackingActionResult } from "@/actions/tracking";

// Runs a customer action from a review screen, then goes back to the order
// with its latest state, whether the action succeeded or the order changed
// in the meantime (the message says which).
export function useTrackingAction(orderPath: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<TrackingActionResult>) {
    startTransition(async () => {
      let result: TrackingActionResult;
      try {
        result = await action();
      } catch {
        result = { ok: false, message: "We couldn't reach the store. Check your connection and try again." };
        toast.error(result.message);
        return;
      }
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      router.replace(orderPath);
      router.refresh();
    });
  }

  return { pending, run };
}
