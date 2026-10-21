import { FlaskConical } from "lucide-react";

export const STAGING_BANNER_TEXT = "Staging: test data only. Payments are in test mode.";

// A thin strip across the top of every page on the staging site, so it is
// never mistaken for the real thing. The layouts show it only when
// isStaging() is true.
export function StagingBanner() {
  return (
    <p
      role="note"
      className="type-caption flex items-center justify-center gap-2 border-b border-warning/60 bg-warning/25 px-page py-1.5 text-center font-medium text-foreground"
    >
      <FlaskConical aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
      {STAGING_BANNER_TEXT}
    </p>
  );
}
