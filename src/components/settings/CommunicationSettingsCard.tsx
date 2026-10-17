"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { setCommunicationSetting } from "@/actions/store-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { COMMUNICATION_SETTING_LABELS, COMMUNICATION_SETTINGS, type CommunicationSetting } from "@/schemas/store-settings";

export type CommunicationValues = Record<CommunicationSetting, boolean>;

const HINTS: Record<CommunicationSetting, string> = {
  smsEnabled:
    "Customers with a Nigerian number get an SMS with their order link, price updates, and when their order is ready or on its way.",
  emailCopiesEnabled: "Customers who gave an email address also get each message by email.",
  whatsappContactEnabled: "Staff can message customers on WhatsApp from their own phone, from the order page.",
};

// The owner's message switches. Each saves at once, and applies to messages
// from now on: ones already waiting to send still go.
export function CommunicationSettingsCard({ initialValues }: { initialValues: CommunicationValues }) {
  const id = useId();
  const [values, setValues] = useState(initialValues);
  const [pending, setPending] = useState<CommunicationSetting | null>(null);

  async function toggle(setting: CommunicationSetting, enabled: boolean) {
    setPending(setting);
    try {
      const result = await setCommunicationSetting(setting, enabled);
      if (result.ok) {
        setValues(result.values);
        toast.success(result.message, {
          description: enabled ? undefined : "Messages already waiting to send still go.",
        });
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("We couldn't save your changes. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card role="region" aria-labelledby={`${id}-title`}>
      <CardHeader>
        <CardTitle id={`${id}-title`} className="type-h3">
          Customer messages
        </CardTitle>
        <CardDescription className="type-body-sm">
          How customers hear about their orders. Every message starts with your store&apos;s name.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-component">
        {COMMUNICATION_SETTINGS.map((setting) => (
          <div key={setting} className="flex items-start justify-between gap-component rounded-lg border border-border p-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor={`${id}-${setting}`} className="type-label text-foreground">
                {COMMUNICATION_SETTING_LABELS[setting]}
              </Label>
              <p id={`${id}-${setting}-hint`} className="type-caption text-muted-foreground">
                {HINTS[setting]}
              </p>
            </div>
            <Switch
              id={`${id}-${setting}`}
              checked={values[setting]}
              onCheckedChange={(checked) => void toggle(setting, checked)}
              disabled={pending !== null}
              aria-describedby={`${id}-${setting}-hint`}
              className="mt-1"
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
