"use client";

import { LinkIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { issueTrackingLink } from "@/actions/tracking-links";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopyLinkButton } from "@/components/workspace/CopyLinkButton";

// "Get tracking link": a fresh link for the customer, shown once. Getting a
// new one stops the old link working, so it asks first. The link lives only
// in this dialog's state: closing it forgets it.
export function TrackingLinkButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close(next: boolean) {
    if (next || pending) return;
    setOpen(false);
    setUrl(null);
  }

  function issue() {
    startTransition(async () => {
      const result = await issueTrackingLink({ orderId });
      if (result.ok) setUrl(result.url);
      else toast.error(result.message);
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LinkIcon data-icon="inline-start" aria-hidden />
        Get tracking link
      </Button>
      {open && (
        <Dialog open onOpenChange={close}>
          <DialogContent className="sm:max-w-md">
            {url ? (
              <>
                <DialogHeader>
                  <DialogTitle>New tracking link</DialogTitle>
                  <DialogDescription>
                    Copy it now and send it to the customer. It is shown only once, and the old link no longer works.
                  </DialogDescription>
                </DialogHeader>
                <Input value={url} readOnly aria-label="Tracking link" onFocus={(event) => event.currentTarget.select()} />
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => close(false)}>
                    Done
                  </Button>
                  <CopyLinkButton url={url} variant="primary" copiedMessage="Tracking link copied" />
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Get a new tracking link?</DialogTitle>
                  <DialogDescription>
                    The customer&apos;s current link will stop working straight away. Send them the new one.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => close(false)} disabled={pending}>
                    Back
                  </Button>
                  <Button type="button" onClick={issue} disabled={pending}>
                    {pending ? "Getting link…" : "Get new link"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
