"use client";

import { CopyIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface CopyLinkButtonProps {
  url: string;
  variant?: ComponentProps<typeof Button>["variant"];
}

// type="button" so it never submits a form it sits in (store settings).
export function CopyLinkButton({ url, variant }: CopyLinkButtonProps) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Booking link copied");
    } catch {
      toast.error("Couldn't copy the link. Select it on the card and copy it instead.");
    }
  }

  return (
    <Button type="button" variant={variant} onClick={copy}>
      <CopyIcon data-icon="inline-start" aria-hidden />
      Copy link
    </Button>
  );
}
