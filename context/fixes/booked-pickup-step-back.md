# Fix — Pickup orders stepped back to Booked

Found 2026-10-16 while completing Feature 14. Work on a branch named `fix/booked-pickup-step-back`. Follow @context/ai-interactions.md and @context/coding-standards.md.

## Findings

At the end of Feature 14 I wrote that "a staff-entered pickup order stepped back to Booked has no move forward". That was wrong for orders created in the app. I had read `getPreviousStage` (Pickup scheduled → Booked) without checking the starting-stage rule. Checked since:

- **The starting-stage rule is enforced.** `canTransition` refuses a step back from the order's starting stage (`src/server/domain/order-stages.ts:102`: "This is the stage the order started at, so it can't step back."). `startingStage` is the `toStage` of the order's first status event (`getStageOrderState`). A unit test covers this exact case (`src/server/domain/order-stages.test.ts:244-245`: a pickup order starting at Pickup scheduled can't step back to Booked).
- **Order entry starts a staff-entered pickup at Pickup scheduled** (`getInitialStage` in `src/lib/orders.ts`), so its first status event is Pickup scheduled and it can never be stepped back to Booked.
- **No other path writes Booked for such an order.** A quote only returns an order to `stageBeforeQuote`, which is Booked only if the order was at Booked when the first priced quote was sent. A staff-entered pickup order is never at Booked. Reopening returns to the stage the order was completed from.

So Feature 11 has no bug here. Two real problems remain.

### 1. Seed data that order entry can't produce

`prisma/seed/freshfold.ts:243-253` (Chinedu, channel `PHONE`, pickup & delivery) has stages `["BOOKED", "PICKUP_SCHEDULED", "PICKED_UP"]`. A staff-entered (phone) pickup order starts at Pickup scheduled, so this seeded order's history is impossible in the app. Because its first event is Booked, Feature 11 lets staff step it back to Booked. Its pickup time stays Confirmed there, so the page then offers no way forward (see 2).

### 2. Online pickup orders stepped back to Booked (a real gap, Features 11 and 14)

An **online** pickup order starts at Booked, so stepping it back from Pickup scheduled to Booked is allowed (it isn't its starting stage). Its `pickupWindowStatus` stays `CONFIRMED`. On the order detail page it then has:

- no forward move: `getAdvanceStage` returns none for a pickup order at Booked (Booked → Pickup scheduled belongs to the pickup-time actions), and `getAvailableTransitions` sets no `blockedReason`, because `canTransition` would allow the move with a confirmed window
- no pickup time card: Feature 14 offers Confirm requested time and Suggest another time only while the time is Requested or Suggested by the store

Only Cancel is left. The customer's tracking page shows "Booking received" with a Confirmed pickup time.

## Proposed fix

### Part 1 (data only, no rule change)

- Change the seeded phone order to start at Pickup scheduled: `stages: ["PICKUP_SCHEDULED", "PICKED_UP"]`, matching order entry
- Add a check in the seed (or the order builder) that each spec's first stage equals `getInitialStage(channel, fulfilmentType)`, and fail the seed otherwise, so impossible histories can't be added again
- Check CleanWave's seed the same way

### Part 2 (Ask First: changes an order-stage rule)

Needs a decision before implementing. Options:

- **A.** Stepping a pickup order back from Pickup scheduled to Booked also returns its time to the customer's request: `pickupWindowStatus = REQUESTED`, scheduled date and window cleared, in the same transaction. Staff then confirm or suggest again with Feature 14's card, and the customer sees "Requested". The customer's original request is kept, so nothing is lost.
- **B.** Offer a forward move "Schedule pickup" (Booked → Pickup scheduled, through `canTransition`) for a pickup order at Booked whose time is already Confirmed.
- **C.** Don't offer Step back from Pickup scheduled for pickup orders at all.

Recommendation: **A**. It reuses Feature 14's confirm and suggest flow, keeps one way into Pickup scheduled, and keeps the customer's view honest ("Requested" instead of a Confirmed time on a Booked order).

## Decision (2026-10-16)

- **Part 1:** approved as written
- **Part 2: option A.** Stepping a pickup order back from Pickup scheduled to Booked also sets the pickup time back to Requested and clears the scheduled date and window, in the same transaction, so the existing card offers Confirm or Suggest again. The reset is shown in the staff timeline. Tests cover the reset and the customer's view afterwards
- Implementation choices: the reset also sets `isOutsideSchedule` off (it describes the cleared scheduled time), and is recorded as a `PICKUP_TIME_RESET` AuditEvent holding the cleared date, window, and outside-schedule flag, so the staff timeline shows exactly what was cleared. The step-back dialog says the time goes back to the customer's request

## Do not change

- The starting-stage rule, or any other `canTransition` rule outside the chosen option
- The schema. No migration is expected

## Tests

- Part 1: the seed refuses a spec whose first stage isn't `getInitialStage(channel, fulfilmentType)`, and the reseeded FreshFold phone pickup order can't be stepped back to Booked
- Part 2 (depending on the option): an online pickup order stepped back to Booked offers a way forward (option A: the pickup time card with the requested time, status Requested, scheduled fields cleared, in one transaction), and its tracking page shows the right pickup status
- Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, the related integration tests, and `npm run build`
