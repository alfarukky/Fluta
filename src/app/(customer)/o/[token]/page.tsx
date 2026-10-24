import type { Metadata } from "next";

import { getTrackingMetadata, renderTrackingPage, trackingPath } from "@/components/tracking/tracking-page";
import { TrackingOrder } from "@/components/tracking/TrackingOrder";
import { isPaymentBeingConfirmed } from "@/server/services/tracking";

// A customer's private tracking link. No sign-in: the token is the
// credential, and it opens exactly one order.

export async function generateMetadata({ params }: PageProps<"/o/[token]">): Promise<Metadata> {
  return getTrackingMetadata((await params).token);
}

// Back from Paystack: /o/{token}?paystack=return&reference=…. Only
// `reference` is read (other names Paystack adds are ignored), and it only
// decides whether "Confirming your payment…" shows.
export default async function TrackingPage({ params, searchParams }: PageProps<"/o/[token]">) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const reference = query.paystack === "return" && typeof query.reference === "string" ? query.reference : null;
  const confirming = reference !== null && (await isPaymentBeingConfirmed(token, reference));
  return renderTrackingPage(token, (view) => (
    <TrackingOrder view={view} basePath={trackingPath(token)} token={token} confirmingPayment={confirming} />
  ));
}
