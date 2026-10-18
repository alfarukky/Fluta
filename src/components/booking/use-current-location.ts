"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseCoordinates, type Coordinates } from "@/lib/location";

export type LocationStatus = "idle" | "locating" | "failed";

// How long the phone gets to find the customer before we give up.
const LOCATION_TIMEOUT_MS = 15_000;

// The phone's current location, asked for only when request() is called (the
// customer tapped the button), never on load. Refused, unavailable, or too
// slow all end as "failed", and the customer types their address as usual.
export function useCurrentLocation(onFound: (location: Coordinates) => void) {
  const [status, setStatus] = useState<LocationStatus>("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("failed");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mounted.current) return;
        const location = parseCoordinates(position.coords.latitude, position.coords.longitude);
        if (!location) {
          setStatus("failed");
          return;
        }
        setStatus("idle");
        onFound(location);
      },
      () => {
        if (mounted.current) setStatus("failed");
      },
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 60_000 },
    );
  }, [onFound]);

  const reset = useCallback(() => setStatus("idle"), []);

  return { status, request, reset };
}
