import type { Metadata } from "next";

import { getTrackingMetadata, renderTrackingPage, trackingPath } from "@/components/tracking/tracking-page";
import { TrackingOrder } from "@/components/tracking/TrackingOrder";

// A customer's private tracking link. No sign-in: the token is the
// credential, and it opens exactly one order.

export async function generateMetadata({ params }: PageProps<"/o/[token]">): Promise<Metadata> {
  return getTrackingMetadata((await params).token);
}

export default async function TrackingPage({ params }: PageProps<"/o/[token]">) {
  const { token } = await params;
  return renderTrackingPage(token, (view) => <TrackingOrder view={view} basePath={trackingPath(token)} />);
}
