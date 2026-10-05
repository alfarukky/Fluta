"use client";

import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function CopyLinkButton({ url }: { url: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Booking link copied");
    } catch {
      toast.error("Couldn't copy the link. Select it on the card and copy it instead.");
    }
  }

  return (
    <Button onClick={copy}>
      <CopyIcon data-icon="inline-start" aria-hidden />
      Copy link
    </Button>
  );
}
