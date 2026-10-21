# Feature 17 — Paystack Online Payments

## Overview

Customers pay online through Paystack, into each store's own bank account. Owners connect their bank account in Settings → Payments. Customers pay from their order page, or in one step at booking ("Book and pay"). Payments count only once Fluta confirms them with Paystack.

**The approved plan is the specification:** @context/docs/paystack-integration-plan.md. Every rule, decision (section 16), file, and test in it applies. This file only sets how the work is split and checked. If this file and the plan ever disagree, the plan wins, and you stop and tell me.

## How to build it

Build **one phase at a time**, in the plan's order (section 14). Each phase is its own `/feature start` to `/feature complete` cycle on its own branch, so each can be reviewed and merged before the next begins:

| Phase | Branch | Plan sections |
| --- | --- | --- |
| 0. Accounts, keys, and answers | none (no code) | 6.1, 10.1, 14 |
| 1. Foundation and local webhooks | `feat/paystack-1-foundation` | 5, 6.7, 9.1, 11 |
| 2. Bank connection | `feat/paystack-2-bank-connection` | 4 |
| 3. Starting payments (including Book and pay) | `feat/paystack-3-checkout` | 3, 6.3 to 6.6, 7 |
| 4. Webhook and verify processing | `feat/paystack-4-confirmation` | 6.7 to 6.9, 7.1, 9.3 |
| 5. The Fluta fee split | `feat/paystack-5-fee-split` | 6.3, 6.10 |
| 6. Production | at launch, with Feature 25 | 10.2, 12 |

## Rules for every phase

- Read the plan sections for the phase before writing code, and confirm the phase's "Before starting" condition
- Every Paystack call goes through `src/server/integrations/paystack.ts`. Tests use a fake client and never call Paystack
- Test mode only. A live key is never used in development
- A phase is done only when its "Verify" checks pass in test mode and its "Ready for next phase when" condition is true. Record the result in `current-feature.md`
- Anything the plan marks **Unconfirmed** is checked in the phase it names, and the answer is written back into the plan
- Ask First applies to the migration (Phase 1), every change to `getBalance` (Phase 4), and anything not covered by the plan

## Done when

- Phases 1 to 5 are merged, each with its own checks passing
- The plan's testing checklist (section 13) passes in full
- The overview's Paystack test-mode checklist is checked as far as test mode allows (plan 13.4)
- Phase 6 is scheduled for launch (Feature 25)

## References

- @context/docs/paystack-integration-plan.md (the specification)
- @context/project-overview.md (Payments, Payment states, Monetization)
- @context/features/16-store-collected-payments-spec.md
