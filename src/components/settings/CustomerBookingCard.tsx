import { DownloadIcon, LinkIcon } from "lucide-react";
import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyLinkButton } from "@/components/workspace/CopyLinkButton";
import type { StoreStatusSummary } from "@/components/workspace/store-status";

interface CustomerBookingCardProps {
  // From getBookingUrl(); Copy and the QR code both use this one value.
  bookingUrl: string;
  // PNG data URL of the QR code for bookingUrl (createQrCodePng).
  qrCodePng: string;
  status: StoreStatusSummary;
  slug: string;
}

// The booking link with Copy, and its QR code with Download PNG. No Preview or
// Open button until the booking page exists (Feature 13).
export function CustomerBookingCard({ bookingUrl, qrCodePng, status, slug }: CustomerBookingCardProps) {
  const { host, pathname } = new URL(bookingUrl);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer booking</CardTitle>
        <CardDescription>{status.description}</CardDescription>
        <CardAction>
          <Badge variant={status.variant} dot>
            {status.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-form">
        <div className="flex flex-col gap-component rounded-lg bg-muted p-3 xs:flex-row xs:items-center">
          <p className="type-body-sm flex min-w-0 flex-1 items-center gap-2 font-medium text-foreground">
            <LinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="break-all">{`${host}${pathname}`}</span>
          </p>
          <CopyLinkButton url={bookingUrl} variant="outline" />
        </div>

        <div className="flex flex-col items-start gap-form xs:flex-row xs:items-center">
          <Image
            src={qrCodePng}
            alt={`QR code for ${host}${pathname}`}
            width={144}
            height={144}
            unoptimized
            className="size-36 shrink-0 rounded-md border border-border"
          />
          <div className="flex flex-col gap-component">
            <p className="type-body-sm text-muted-foreground">
              Print this QR code for your counter, flyers or bags. It opens your booking link.
            </p>
            <Button asChild variant="outline" className="w-fit">
              <a href={qrCodePng} download={`${slug}-booking-qr.png`}>
                <DownloadIcon data-icon="inline-start" aria-hidden />
                Download PNG
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
