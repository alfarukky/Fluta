import { PhoneIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface TrackingMessageProps {
  icon: LucideIcon;
  title: string;
  description: string;
  // A Call link to the store, when there is one to show.
  call?: { label: string; href: string } | null;
  back?: { label: string; href: string } | null;
  // h1 when no store header is shown above it.
  headingLevel?: "h1" | "h2";
}

// A link that can't show an order (invalid, expired, or no longer
// available), or a review screen with nothing left to review.
export function TrackingMessage({ icon: Icon, title, description, call, back, headingLevel = "h2" }: TrackingMessageProps) {
  const Heading = headingLevel;
  return (
    <section className="flex flex-col items-start gap-component rounded-xl border border-border bg-card p-card">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <Heading className="type-h2 text-card-foreground">{title}</Heading>
      <p className="type-body text-muted-foreground">{description}</p>
      {(call || back) && (
        <div className="flex flex-wrap gap-2">
          {call && (
            <Button asChild>
              <a href={call.href}>
                <PhoneIcon data-icon="inline-start" aria-hidden />
                {call.label}
              </a>
            </Button>
          )}
          {back && (
            <Button asChild variant="outline">
              <Link href={back.href}>{back.label}</Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
