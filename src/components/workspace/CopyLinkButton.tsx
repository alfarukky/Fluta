"use client";

import { CopyIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface CopyLinkButtonProps {
  url: string;
  variant?: ComponentProps<typeof Button>["variant"];
  copiedMessage?: string;
  className?: string;
}

// type="button" so it never submits a form it sits in (store settings).
export function CopyLinkButton({ url, variant, copiedMessage = "Booking link copied", className }: CopyLinkButtonProps) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(copiedMessage);
    } catch {
      toast.error("Couldn't copy the link. Select it and copy it instead.");
    }
  }

  return (
    <Button type="button" variant={variant} onClick={copy} className={className}>
      <CopyIcon data-icon="inline-start" aria-hidden />
      Copy link
    </Button>
  );
}
