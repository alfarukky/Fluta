import { MapPinnedIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getGoogleMapsUrl, type Coordinates } from "@/lib/location";
import { cn } from "@/lib/utils";

interface OpenInMapsButtonProps {
  location: Coordinates;
  className?: string;
}

// The customer's shared location in Google Maps, for the store's own owners,
// staff, and riders only. A plain link, opened in a new tab.
export function OpenInMapsButton({ location, className }: OpenInMapsButtonProps) {
  return (
    <Button asChild variant="outline" className={cn(className)}>
      <a href={getGoogleMapsUrl(location.latitude, location.longitude)} target="_blank" rel="noopener noreferrer">
        <MapPinnedIcon data-icon="inline-start" aria-hidden />
        Open in Maps
      </a>
    </Button>
  );
}
