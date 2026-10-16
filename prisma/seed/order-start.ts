import type { FulfilmentType, OrderChannel, OrderStage } from "@/generated/prisma/enums";

import { getInitialStage } from "@/lib/orders";

// A seeded order's history must start where the app's own order entry would
// start it (getInitialStage), or it describes an order the app can't make.
// The first stage is the order's starting stage, which decides whether it can
// be stepped back (canTransition), so an impossible start allows moves that
// real orders never get.
export function getSeedStartProblem(spec: {
  channel: OrderChannel;
  fulfilmentType: FulfilmentType;
  stages: readonly OrderStage[];
}): string | null {
  const expected = getInitialStage(spec.channel, spec.fulfilmentType);
  const first = spec.stages[0];
  if (first === expected) return null;
  return `Seed data: a ${spec.channel} ${spec.fulfilmentType} order starts at ${expected}, not ${first ?? "nothing"}.`;
}
