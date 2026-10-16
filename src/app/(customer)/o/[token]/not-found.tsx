import { LinkIcon } from "lucide-react";

import { TrackingMessage } from "@/components/tracking/TrackingMessage";
import { TrackingShell } from "@/components/tracking/TrackingShell";
import { TRACKING_MESSAGES } from "@/server/services/tracking";

// An unknown or malformed tracking link (HTTP 404). Nothing about any store.
export default function TrackingNotFound() {
  return (
    <TrackingShell store={null}>
      <TrackingMessage icon={LinkIcon} headingLevel="h1" title="Link not valid" description={TRACKING_MESSAGES.invalid} />
    </TrackingShell>
  );
}
