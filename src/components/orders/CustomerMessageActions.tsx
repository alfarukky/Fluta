"use client";

import { MessageCircleIcon, MessageSquareTextIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { openWhatsApp, sendLinkBySms } from "@/actions/messages";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { useOrderAction } from "./use-order-action";

interface CustomerMessageActionsProps {
  orderId: string;
  // A new link would work for this order.
  canIssueLink: boolean;
  // A Nigerian number, with the store's SMS on.
  canSendLinkBySms: boolean;
  // The store's WhatsApp button setting.
  whatsappEnabled: boolean;
}

type LinkAction = "SMS" | "WHATSAPP";

// "Send link by SMS", "Send link by WhatsApp", and "Message on WhatsApp".
// Both link buttons issue a fresh link, so they ask first: the customer's
// current link stops working. WhatsApp opens on the staff member's own
// phone with a message they can edit, and Fluta records only that it opened.
export function CustomerMessageActions({ orderId, canIssueLink, canSendLinkBySms, whatsappEnabled }: CustomerMessageActionsProps) {
  const { pending, run } = useOrderAction();
  const [confirming, setConfirming] = useState<LinkAction | null>(null);
  const [opening, setOpening] = useState(false);

  const smsOffered = canIssueLink && canSendLinkBySms;
  const whatsappLinkOffered = canIssueLink && whatsappEnabled;
  if (!smsOffered && !whatsappEnabled) return null;

  async function startWhatsApp(withLink: boolean) {
    // Opened now, while the tap still counts as the user's, so the browser
    // doesn't block it. It goes to WhatsApp once the link is ready.
    const chat = window.open("about:blank", "_blank");
    setOpening(true);
    try {
      const result = await openWhatsApp({ orderId, withLink });
      if (!result.ok) {
        chat?.close();
        toast.error(result.message);
        return;
      }
      if (chat) {
        chat.opener = null;
        chat.location.href = result.url;
      } else {
        window.location.assign(result.url);
      }
      setConfirming(null);
    } catch {
      chat?.close();
      toast.error("Something went wrong. Please try again.");
    } finally {
      setOpening(false);
    }
  }

  function confirm() {
    if (confirming === "SMS") run(() => sendLinkBySms({ orderId }), () => setConfirming(null));
    else void startWhatsApp(true);
  }

  const busy = pending || opening;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {smsOffered && (
          <Button variant="outline" onClick={() => setConfirming("SMS")} disabled={busy}>
            <SendIcon data-icon="inline-start" aria-hidden />
            Send link by SMS
          </Button>
        )}
        {whatsappLinkOffered && (
          <Button variant="outline" onClick={() => setConfirming("WHATSAPP")} disabled={busy}>
            <MessageSquareTextIcon data-icon="inline-start" aria-hidden />
            Send link by WhatsApp
          </Button>
        )}
        {whatsappEnabled && (
          <Button variant="outline" onClick={() => void startWhatsApp(false)} disabled={busy}>
            <MessageCircleIcon data-icon="inline-start" aria-hidden />
            Message on WhatsApp
          </Button>
        )}
      </div>
      {whatsappEnabled && (
        <p className="type-caption text-muted-foreground">WhatsApp opens on your phone with a message you can edit before sending.</p>
      )}

      {confirming && (
        <Dialog open onOpenChange={(open) => !open && !busy && setConfirming(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{confirming === "SMS" ? "Send a new link by SMS?" : "Send a new link by WhatsApp?"}</DialogTitle>
              <DialogDescription>
                The customer&apos;s current link will stop working straight away.
                {confirming === "SMS"
                  ? " They also get an email copy if they gave an email address."
                  : " WhatsApp opens with the new link in a message you can edit."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
                Back
              </Button>
              <Button type="button" onClick={confirm} disabled={busy}>
                {busy ? "Working…" : confirming === "SMS" ? "Send link" : "Open WhatsApp"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
