# Paystack Integration Plan (Feature 17)

**Status:** **Approved** on 20 October 2026, with one required fix (`PAYMENT_REQUIRED` applies only to online orders, see 9.3) and the owner's decisions in section 16. Do not start Phase 0 or Phase 1 until Feature 16 is merged.
**Researched:** 20 October 2026

## How this plan was researched

- Codebase: read on `main` at commit `10897da`.
- Paystack: `paystack.com` refuses automated page fetches (HTTP 403 for every docs page, even with a browser user agent). The official pages were therefore read through Context7's index of `paystack.com/docs` (library `/websites/paystack`), which quotes each page with its original URL. Every Paystack claim below cites that original page as `[S#]` (see Sources at the end).
- Where a page could not be read at all, or the docs say nothing on a point, the plan says **Unconfirmed** and lists a test-mode check that settles it.
- No Paystack MCP server was used.

---

## 1. Summary

Fluta takes online payments through Paystack checkout. Each store's bank account becomes a Paystack **subaccount**. Every transaction is initialized server-side with that subaccount, `bearer: "subaccount"`, and Fluta's fee as a flat `transaction_charge` worked out from the store's current rate (₦0 at 0%). The customer pays on Paystack's own page. A payment counts only after Fluta confirms it from Paystack's signed webhook or from a server-side verify call. Both routes go through one function that confirms a `Payment` row exactly once, keyed by its unique `paystackReference`. The order's payment state keeps coming only from `getBalance`.

Feature 17 depends on Feature 16 (store-collected payments), which is specified but not built yet. Build Feature 16 first.

---

## 2. Current state analysis

### 2.1 The `Payment` model as built

From `prisma/schema.prisma`:

| Field                                                                          | Built  | Notes                                                           |
| ------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------- |
| `amount` (Int, kobo)                                                           | Yes    |                                                                 |
| `source` (`ONLINE`, `STORE_COLLECTED`)                                         | Yes    |                                                                 |
| `method` (`PAYSTACK`, `CASH`, `BANK_TRANSFER`, `POS`, `OTHER`)                 | Yes    |                                                                 |
| `status` (`PENDING`, `CONFIRMED`, `FAILED`, `VOIDED`), default `PENDING`       | Yes    |                                                                 |
| `paystackReference String? @unique`                                            | Yes    | The idempotency key for online payments                         |
| `payerEmail String?`                                                           | Yes    |                                                                 |
| `confirmedAt`, `voidedAt`, `voidedByUserId`, `voidReason`, `replacesPaymentId` | Yes    |                                                                 |
| `recordedByUserId`, `note`                                                     | Yes    |                                                                 |
| `clientRequestId`                                                              | **No** | Feature 16 adds it, with `@@unique([storeId, clientRequestId])` |
| `flutaFeeBps`, `flutaFeeAmount`                                                | **No** | In the overview's draft schema, not in the built schema         |

There is no code that creates, reads, or lists payments yet, apart from `getBalance` and the order detail's read-only payments list (`src/components/orders/OrderDetail.tsx:534`, which already hides `FAILED` payments).

### 2.2 `Store` fields for Paystack

Built: `paystackSubaccountCode` (null means not connected), `settlementBankName`, `settlementAccountName`, `settlementAccountLast4`, `paystackConnectedAt`, `payLaterEnabled` (default `false`).

**Not built:** `onlineFeeBps` (the overview's draft has `Int @default(0)`, "max 500"). No migration so far touches any Paystack field, and nothing in `src/` reads them.

### 2.3 `getBalance`

`src/server/domain/balance.ts`: `balance = approved total − confirmed payments + refunds paid`. It counts only `CONFIRMED` payments that are not voided, and a cancelled order's total counts as 0. Its states are `AWAITING_QUOTE`, `PAID`, `OUTSTANDING`, `REFUND_OWED`, and `NOTHING_DUE`.

The overview also lists **Payment required** and **Pending**. `src/lib/orders.ts:46-48` notes these "come with online payments (Features 13 and 17)". Section 9.3 covers them.

Callers:

- `src/server/services/orders.ts:58` and `:183` (orders list and order detail)
- `src/server/services/tracking.ts:59` and `:279` (tracking page and its actions)
- `src/server/services/tracking-links.ts:27` (resending a link)
- `src/lib/tokens.ts` `getTrackingLinkStatus` takes `getBalance(order).state` (a link stays valid while a refund is owed)
- The SQL payment filter in `src/server/data/orders.ts:382` mirrors `getBalance`, and an integration test keeps the two in step
- The Payments page (`src/app/(staff)/(workspace)/payments/page.tsx`) is still "Coming soon". Feature 16 builds it.

### 2.4 How Feature 16 will record payments (to reuse)

Feature 16 is not built, so this comes from its spec (`context/features/16-store-collected-payments-spec.md`):

- A UUID request ID per form (`Payment.clientRequestId`), with duplicates caught by the unique rule, as in Feature 09 (`findOrderByClientRequestId` in `src/server/data/orders.ts:285`)
- Voids use one conditional update, and each void writes an `AuditEvent`
- Each payment appears in the staff timeline through Feature 12's timeline helper (`src/server/data/order-timeline.ts`, which merges stage events, revisions, and audit-based entries)
- Feature 16's Payments page splits totals into store-collected and online

Feature 17 reuses the timeline helper (adding "Online payment received: ₦X (Paystack)"), the Payments page (online rows already have a column), and the audit-event pattern. Online payments don't need `clientRequestId`, because `paystackReference` is already unique (see 6.4).

### 2.5 The customer order page (`/o/[token]`)

- `src/app/(customer)/o/[token]/page.tsx` → `renderTrackingPage` (`src/components/tracking/tracking-page.tsx`) → `loadTrackingPage` (`src/server/services/tracking.ts`)
- Token checks: `isWellFormedToken` (43 base64url characters), then a lookup by `hashToken` (SHA-256), then `getTrackingLinkStatus` (store Deactivated, or expiry 30 days after closing unless a refund is owed)
- Headers: `next.config.ts` sends `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and `X-Robots-Tag: noindex, nofollow` on `/o/:token/:path*`. The page metadata also sets `referrer: "no-referrer"` and noindex. Development request logs skip `/o/`.
- Actions: `src/actions/tracking.ts` are Server Actions taking `(token: unknown, request: unknown)`. They parse with Zod, call a service that re-checks the token and the link, and return `{ ok, message }`. Errors are logged as class name and code only.
- The page reads the order fresh on every load (no shared cache), so a reload after payment shows the new balance.
- "Pay now" belongs in the payment card on `TrackingOrder.tsx`, next to the `payment` line from `getCustomerPaymentText`.

### 2.6 The booking flow (Feature 13)

- `submitBooking` (`src/server/services/booking.ts:111`) → `createOnlineOrder` (`src/server/services/order-entry.ts:232`) always sets `payLater: true`
- The review step says "No payment is needed now. You'll pay the store later." (`src/components/booking/ReviewStep.tsx:71`)
- Spec 13 line 57: "Every online order is created as pay later … Feature 17 adds 'Pay now' for stores connected to Paystack"
- `Order.payLater Boolean @default(false)` exists. Staff-entered orders set `false`.

### 2.7 Existing payment code, variables, and placeholders

- No `src/server/integrations/paystack.ts`, no `src/app/api/webhooks/`, and no Paystack variables in `src/lib/env.ts` or `.env.example`
- No `proxy.ts` or middleware, so nothing global guards `/api/*`. Each route protects itself (the logo route checks `Origin` and the session, and the cron route checks a bearer secret).
- Reusable pieces:
  - `readBodyWithLimit` (`src/lib/read-body.ts`) for raw bytes with a size cap
  - The timing-safe compare in `src/server/auth/cron.ts`
  - The fetch-with-timeout and short-error-code pattern in `src/server/integrations/termii.ts`
  - `getMailer()` for owner emails
  - `FLUTA_ALERT_EMAIL` for Fluta alerts
  - The cron job at `/api/cron/messages`

### 2.8 One mismatch to note

`coding-standards.md` says actions return `{ success, data, error }` with a stable `code`. The built actions return `{ ok, message, fieldErrors? }` (`src/actions/store-settings.ts`, `src/actions/tracking.ts`).

**Decided:** keep the built `{ ok, message }` shape, and update `coding-standards.md` (Error Handling) to match as part of Phase 1.

---

## 3. Payment availability

### 3.1 When an order can be paid online

All of these must be true, checked on the server in one domain function, `canPayOnline(order, store, now)` in `src/server/domain/online-payment.ts`:

1. The store is connected (`paystackSubaccountCode` is not null)
2. The store is not Deactivated. The overview lets guests pay on existing links while the store is Active or Paused, and even while the subscription is Suspended ("customers can still track and pay").
3. The tracking link is valid (`getTrackingLinkStatus` returns `VALID`)
4. The order is not Cancelled
5. `getBalance(order).state` has a positive balance (`OUTSTANDING`, or the new `PAYMENT_REQUIRED` and `PENDING` from 9.3)
6. No price update is waiting for the customer's approval. Paying the old total while a new one is pending invites confusion, so approval comes first.

`canPayOnline` returns `{ allowed: false, reason }` for expected refusals, as the domain rules require.

### 3.2 Fixed-price online bookings

- If the store is connected, `payLaterEnabled` is false, and the order has an approved total at creation (no quote-required lines and no quoted charge), the order is created with `payLater = false`.
- **Book and pay (decision 13).** For these bookings the review step's final button reads **"Book and pay ₦6,200"** (the approved total). One tap creates the order and goes straight to Paystack's checkout, with no separate Pay now step:
  - `submitBooking` creates the order in its existing transaction (with its `clientRequestId`, so a double tap still makes one order). It then starts the payment for that order through the same `startPayment` service as the tracking page (pending `Payment` first, then initialize).
  - The action returns the Paystack `checkoutUrl` together with the order's link, and the browser goes straight to checkout.
  - Paystack requires an email [S2], so on this path the email field in "Your details" is required, with the hint "For your Paystack receipt". On every other path it stays optional.
  - The `callback_url` is the new order's tracking link, so the customer returns to their order page and sees "Confirming your payment…" (section 7).
  - The customer may leave or cancel checkout, or Paystack's initialize may fail after the order is saved. In each case the order stays, shows **Payment required**, and can be paid from the order link (Pay now on the tracking page). If initialize fails, the booking confirmation screen shows the order link and a **Pay now** button to try again, instead of an error that hides the saved booking.
  - The review step's line changes from "You'll pay the store later" to "You'll pay on Paystack's secure page after tapping Book and pay", plus the anti-fraud warning line (3.6).
  - **The order link is always emailed.** Checkout skips the booking confirmation screen, which is where a customer would otherwise see their link (for example when the daily SMS cap is reached). So for every Book and pay booking, the order-link message (`LINK_CREATED`) is always queued by email, in the same transaction as the order, **even when the store's email copies setting is off**:
    - `chooseDestinations` (`src/server/domain/messages.ts`) gains `alwaysEmail: boolean`. It is true only for the `LINK_CREATED` message of a Book and pay booking, and adds the email destination whatever `emailCopiesEnabled` says.
    - The recipient is the email entered at booking (required on this path). For an existing customer whose saved email differs, Feature 13's never-overwrite rule still keeps the saved one on the customer. This one message goes to the email typed for this booking.
    - The SMS follows its usual rules (Nigerian number, store SMS on, within the daily cap).
    - Only this one message is forced. Later messages (price update, ready, on its way) still follow the email copies setting.
  - **A repeated submit doesn't start a second payment.** A repeated Book and pay submit (the same request ID, so the same order, see Feature 13's `clientRequestId`) for an order that already has a `PENDING` online attempt under 15 minutes old returns the order link **without starting a new payment**. The customer lands on their order page, which shows "A payment is being confirmed" (section 7). A repeated submit after 15 minutes, or after the attempt failed, starts a new attempt as usual.
- If `payLaterEnabled` is true, the order is pay later (`payLater = true`). The tracking page still offers Pay now whenever a balance is due.
- If the store is not connected, the order is always `payLater = true`, as now.
- The order is created **before** payment, so a customer who closes checkout still has a booking. Its payment state shows **Payment required** to staff (see 9.3).
- **Decided:** unpaid "pay now" bookings are never cancelled automatically. Staff decide, and the orders are visible as Payment required.

### 3.3 Orders that need a price from the store

These are paid only after the customer approves the final total. Until then `getBalance` returns `AWAITING_QUOTE` and there is no Pay now.

### 3.4 Part payments

**Recommendation:** an online payment always pays the **full balance due** at the moment it starts. The customer never types an amount. This keeps the fee and amount checks simple and matches "Fluta requests only the extra amount owed" after a revision. Part payments stay possible at the store (Feature 16).

### 3.5 Stores not yet connected

No Pay now anywhere: not on the booking review, the confirmation screen, or the tracking page. The booking review keeps "You'll pay the store later." The server refuses to start a payment even if the button is forced (rule 1 in 3.1).

### 3.6 Anti-fraud rules (roadmap, Feature 17)

- Online payment only on Paystack's checkout page (`authorization_url`). Fluta never shows an account number to transfer to.
- The payment step carries one warning line, for example: "You'll pay on Paystack's secure page. FreshFold Laundry will never ask you to transfer money to a personal account."
- **Decided:** Fluta does not send a `channels` list, so Paystack's default channels apply. Paystack's checkout may itself offer "bank transfer" to a Paystack-managed account [S2]. That happens on Paystack's own page and is not an account shown by Fluta, so it fits the rule.

---

## 4. Owner settings analysis

### 4.1 Where Settings → Payments fits

- New page `src/app/(staff)/(workspace)/settings/payments/page.tsx`, owner-only, calling `requireStoreMember({ role: "OWNER" })` itself
- `SettingsNav` (`src/components/settings/SettingsNav.tsx`) gains a third link, "Payments"
- Every change goes through `requireOwnerCanEdit()` (Feature 07's shared edit check, `checkOwnerCanEdit` in `src/server/auth/access.ts`) and `ownerEditRefusalMessage`, like `src/actions/store-settings.ts`. Feature 05's spec already lists "Payments / Paystack connection (Feature 17)" as deferred.

### 4.2 Bank connection flow

**Not connected** (one card, "Online payments"):

1. **Business name.** Pre-filled with the store name and editable, sent as `business_name` [S4].
2. **Bank.** A select, loaded server-side from `GET /bank?country=nigeria&currency=NGN` [S5]. Keep `active: true` and `is_deleted: false` banks only. The list can be cached for a day, since it is not order data.
3. **Account number.** Exactly 10 digits (NUBAN), validated with Zod.
4. **Check account.** The `resolveSettlementAccount` action calls `GET /bank/resolve?account_number=…&bank_code=…` [S6][S7] and shows "Account name: AMINA BELLO. Is this your account?"
5. **Confirm and connect.** The `connectSettlementAccount` action:
   - looks the account up on the server (it never trusts a name sent back from the browser) and checks it matches what the owner confirmed. **Decided 22 Oct 2026:** the server reuses its own successful lookup from "Check account" for 10 minutes (kept in server memory per store, bank code, and account number, keyed by a hash so no account number is held), so a connect or change uses one Paystack lookup instead of two. Paystack limits lookups, in test mode to a few a day (6.1)
   - calls `POST /subaccount` with `business_name`, `bank_code`, `account_number`, and `percentage_charge: 0`, plus `primary_contact_email` set to the owner's sign-in email [S4]
   - saves `paystackSubaccountCode`, `settlementBankName`, `settlementAccountName`, `settlementAccountLast4`, and `paystackConnectedAt`, and writes `AuditEvent` `PAYSTACK_CONNECTED`, in one transaction
6. **Connected.** Settings shows "Connected", the bank name, the account name, "•••• 4521", the connection date, and the Fluta fee line.

Notes:

- `percentage_charge` is "the percentage the main account receives from each payment made to the subaccount" [S4]. Setting it to 0 means Fluta takes nothing unless a transaction says otherwise. An older Paystack page describes `percentage_charge` differently (its example `0.2` is described as sending 20% to the subaccount) [S24]. That older page disagrees with the current API reference, so this plan follows the current one [S4].
- The full account number is sent to Paystack and never stored by Fluta (last 4 only), as `coding-standards.md` requires.
- **Double submit.** Save with a conditional update (`WHERE paystackSubaccountCode IS NULL`). If a second subaccount was created by a race, deactivate it with `PUT /subaccount/:code` and `active: false` [S4], and log its code (not secret).
- **Failure order.** Paystack is called first here, because there is no meaningful state to write before the subaccount exists. If the database save fails after Paystack succeeds, log the subaccount code so it can be linked or deactivated by hand. A retry resolves and creates again, which is safe because the orphan is deactivated.
- The create response includes `is_verified: false` and `settlement_schedule: "AUTO"` [S4]. What `is_verified` means for settlements is **Unconfirmed**.
- One API example still sends `settlement_bank` while the parameter list says `bank_code` [S4]. Follow the parameter list (`bank_code`), which the API reference's own cURL example also uses [S4].

### 4.3 Changing bank details

- Owner-only. The same resolve-and-confirm steps as connecting.
- Uses `PUT /subaccount/:id_or_code` with `bank_code` and `account_number` [S4], so the **subaccount code stays the same**. Past payments and pending checkouts still match the store.
- Updates the four settlement fields. Writes `AuditEvent` `PAYSTACK_BANK_CHANGED` with the old and new bank name and last 4 only, never full numbers.
- Emails the owner a notice: "FreshFold Laundry: the bank account for online payments was changed to GTBank •••• 4521 on 20 Oct 2026, 3:15 PM. If you didn't do this, contact Fluta support now." It goes to the owner's sign-in email (`User.email`), not the public store email. `MessageEvent` needs an `orderId`, so this goes through the mailer directly, like invitation and password emails. It is sent after the commit, and the outcome is logged.
- Whether Paystack re-resolves the account name on update is **Unconfirmed**. Fluta resolves it itself before calling update.
- **Decided:** the owner re-enters their password before bank details change. A stolen session that redirects payouts is the costliest attack on this feature (see Risks).
  - The change action checks the password on the server, through Better Auth, against the signed-in owner's own credential account, before calling Paystack.
  - A wrong password changes nothing. It returns "That password isn't right" and counts toward Better Auth's sign-in rate limit.
  - **Confirmed in Phase 2 (Better Auth 1.7.7):** `POST /verify-password` checks the signed-in user's own credential account (`validatePassword` → `findCredentialAccount(session.user.id)`) and starts no session. A wrong password is HTTP 400 (`INVALID_PASSWORD`). Rate limits apply only to HTTP requests, so `src/server/auth/password-check.ts` sends it through `getAuth().handler` with the caller's cookie and client IP. `/verify-password` has its own rule with the sign-in limit (10 per 5 minutes per IP), because Better Auth keys each limit by IP and path, so it can't share the `/sign-in/email` counter.
  - First-time connection doesn't need the password. Nothing is being redirected yet, and the audit entry still records who connected.

### 4.4 Fee display

"Fluta fee: 0% of online payments", formatted from `Store.onlineFeeBps` by a helper in `src/lib/money.ts` (`formatBasisPoints(150)` → "1.5%"). A short line explains: "Paystack's fees are taken from each online payment before it reaches your bank."

**Decided 23 Oct 2026 (owner):** Settings → Payments doesn't show the Fluta fee line. While the fee is 0% it tells the owner nothing, so Phase 2 shows only the Paystack fees note, and `formatBasisPoints` isn't added. Showing a non-zero fee to owners, if wanted, is decided with Feature 23's admin screen.

### 4.5 Pay later toggle

When connected, Settings → Payments also shows **"Let customers pay later"** (`payLaterEnabled`). It is off by default, so fixed-price bookings ask for payment at booking. When not connected the toggle is hidden, and every online order is pay later.

### 4.6 Setting the Fluta fee

Only Fluta admins change `onlineFeeBps` (overview, Monetization). The admin area is still a placeholder (Feature 23).

**Decided:** Feature 17 adds the column (default 0, CHECK 0 to 500) and the per-transaction logic. Nobody sets a fee before Feature 23's admin screen exists, so the rate stays 0% for every store until then. Phase 5 tests a non-zero rate on the development database only.

---

## 5. API and webhook patterns

### 5.1 Route structure

- Webhook: `src/app/api/webhooks/paystack/route.ts` (named in `coding-standards.md`)
- Next 16 route handlers get the raw `Request` and need no `bodyParser` configuration: "unlike API Routes with the Pages Router, you do not need to use `bodyParser`" [S27]
- POST only. Every other method gets 405 automatically.

### 5.2 What the webhook route must not inherit

- **No `Origin` check.** The logo route refuses requests whose `Origin` differs from the app (`src/app/api/v1/store/logo/route.ts`). Paystack's servers send no browser `Origin`, so the webhook must not copy that check.
- **No session check.** No `requireStoreMember` or `authorize*`.
- Its only protection is the signature (and optionally Paystack's IP addresses, see 6.6). Since there is no global `proxy.ts`, nothing else needs changing.

### 5.3 Server action pattern for starting a payment

`src/actions/online-payments.ts` (`"use server"`), shaped like `src/actions/tracking.ts`:

```ts
export async function startOnlinePayment(
  token: unknown,
  request: unknown,
): Promise<StartPaymentResult> {
  const parsedToken = trackingTokenSchema.safeParse(token);
  if (!parsedToken.success)
    return { ok: false, message: TRACKING_MESSAGES.invalid };
  const parsed = startPaymentSchema.safeParse(request); // { email }
  if (!parsed.success)
    return {
      ok: false,
      message: 'Enter a valid email address.',
      fieldErrors: { email: '…' },
    };

  try {
    return await startPayment(parsedToken.data, parsed.data, new Date());
  } catch (error) {
    logger.error(
      '[online-payments] starting a payment failed:',
      describeError(error),
    );
    return {
      ok: false,
      message: "We couldn't start your payment. Please try again.",
    };
  }
}

type StartPaymentResult =
  | { ok: true; checkoutUrl: string } // Paystack's authorization_url
  | { ok: false; message: string; fieldErrors?: Record<string, string> };
```

The client sends the browser to `checkoutUrl` with `window.location.assign`. The URL comes only from Paystack's response, checked to start with `https://checkout.paystack.com/` [S2].

### 5.4 Environment variables

Add to `src/lib/env.ts` (the only file reading `process.env`) and `.env.example`:

| Variable              | Rule                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `PAYSTACK_SECRET_KEY` | Matches `^sk_(test\|live)_`. Used for API calls **and** webhook signatures (Paystack signs with the secret key [S1]). |
| `PAYSTACK_MODE`       | `test` or `live`. Must agree with the key prefix.                                                                     |

Rules in `parseServerEnv`, like `termiiProblems`. Production is detected with the existing `DATABASE_BRANCH` variable (`z.enum(["development", "test", "production"])`, `src/lib/env.ts:15`), together with `NODE_ENV`:

- `NODE_ENV=production` with `DATABASE_BRANCH=production` requires `live` and an `sk_live_` key
- Any other branch (`development`, `test`) **refuses** an `sk_live_` key, so live money can never touch a development database
- Unset is allowed outside production. Online payments are then simply unavailable (settings shows "Online payments aren't set up in this environment").

Integration tests never call Paystack. They inject a fake client, as they already do for R2 and the mailer. `.env.test` leaves both unset or uses placeholders.

A public key (`pk_…`) is not needed, because Fluta uses the redirect flow and not Popup or InlineJS [S9].

Keys stay apart like this:

- `.env.local`: `sk_test_` key
- `.env.test`: none
- Railway production: `sk_live_` key
- Railway staging, if added: `sk_test_` key

Paystack issues separate key pairs per mode, prefixed `sk_test_` and `sk_live_` [S15].

### 5.5 Integration boundary

Only `src/server/integrations/paystack.ts` calls `api.paystack.co`. It starts with `import "server-only"`, uses `fetch` with `AbortSignal.timeout`, parses every response with Zod, and throws `PaystackError` with a short code only (`"HTTP 400 validation_error"`, `"timeout"`). Paystack error bodies carry `status`, `message`, `type`, and `code` [S16]. No new npm dependency is needed. On `429`, it reads `x-ratelimit-reset` and does not retry in a loop [S17].

### 5.6 Logging and redaction

Never log:

- the secret key or the `Authorization` header
- the full webhook body
- the account number
- the payer's email
- the customer's phone
- the tracking token (already scrubbed from `/o/…` paths)
- `authorization.*` card details from Paystack responses (`authorization_code`, `bin`, `last4`, `signature`) [S2]

Log only the payment ID, order ID, store ID, the Paystack reference, the event name, and error codes.

Add these to `REDACTED_FIELDS` in `src/lib/logger.ts`, which matches field-name endings: `accountNumber`, `account_number`, `email`, `authorization`, `authorization_code`, `secretKey`. The matcher compares `toLowerCase().endsWith(field)`, so entries must be lower-case (for example `"accountnumber"` and `"account_number"`). Add a unit test with a recorded Paystack payload.

Also extend `next.config.ts` `logging.incomingRequests.ignore` with `/\/api\/webhooks\//`. The webhook URL carries no secret, but there is no reason to log it on every retry.

---

## 6. Paystack questions answered

### 6.1 Test mode versus live business verification

- Test and live are separate environments with separate keys. In test mode "settlements aren't processed … and some payment channels are unavailable" [S15].
- Works in test mode straight away with test keys: List Banks, initialize, verify, webhooks, and test cards [S10]. Creating subaccounts in test mode also works: the documented create response shows `"domain": "test"` [S4].
- Whether `GET /bank/resolve` returns real account names in test mode, or has a daily test limit, is **Unconfirmed**. The docs say only that the feature "is available to business in Nigeria and Ghana" [S7]. Check in Phase 0.
  - **Observed in Phase 2 (22 Oct 2026):** test mode returns the real account holder's name for a real account. After 3 lookups that day, Paystack answered `HTTP 429 api_error` to every further `GET /bank/resolve`, which matches a small daily test-mode limit. Each connect or change uses two lookups ("Check account", then the server's own check on confirm), so test mode allows about one connect or change a day. Fluta shows a 429 as "Paystack has had too many requests from us. Please try again later." Live-mode limits are not documented in the sources read. Paystack's own 429 message: "Test mode daily limit of 3 live bank resolves exceeded. Use test bank codes 001 or upgrade to live mode." The count appears to reset at midnight UTC. Test bank code `001` (account `0000000000` → "TEST ACCOUNT 0000000000") resolves without counting, but it is not in `GET /bank`, so Fluta's bank list doesn't offer it (left as is, owner's decision 23 Oct 2026).
- What Paystack requires before live mode (business activation documents and review) is **Unconfirmed**, because the docs read do not list it. Check the dashboard's activation checklist in Phase 0. Also ask Paystack support whether Fluta's model (collecting for many stores through subaccounts) needs any extra approval.

### 6.2 Banks, account resolution, and subaccount creation

| Step              | Endpoint                                             | Required                                                                                                                                                                           | Returns                                                                                                                                        | Source   |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| List banks        | `GET https://api.paystack.co/bank`                   | none. Optional: `country` (`nigeria`), `currency`, `perPage` (default 50, max 100), `use_cursor`, `next`                                                                           | `data[]` with `name`, `code`, `active`, `is_deleted`, `type` (`nuban`), and `meta.next`                                                        | [S5]     |
| Resolve account   | `GET https://api.paystack.co/bank/resolve`           | `account_number`, `bank_code`                                                                                                                                                      | `data.account_number`, `data.account_name`                                                                                                     | [S6][S7] |
| Create subaccount | `POST https://api.paystack.co/subaccount`            | `business_name`, `bank_code`, `account_number`, `percentage_charge`. Optional: `description`, `primary_contact_email`, `primary_contact_name`, `primary_contact_phone`, `metadata` | 201 with `data.subaccount_code` (`ACCT_…`), `settlement_bank` (name), `account_name`, `is_verified`, `settlement_schedule`, `active`, `domain` | [S4]     |
| Update subaccount | `PUT https://api.paystack.co/subaccount/:id_or_code` | none. Optional: `business_name`, `bank_code`, `account_number`, `active`, `percentage_charge`, and others                                                                          | updated subaccount                                                                                                                             | [S4]     |
| Fetch subaccount  | `GET https://api.paystack.co/subaccount/:id_or_code` | none                                                                                                                                                                               | subaccount                                                                                                                                     | [S4]     |

All of these use `Authorization: Bearer SECRET_KEY`, and POST and PUT also send `Content-Type: application/json` [S4][S6].

Pagination: List Banks pages at 50 by default [S5]. Request `perPage=100` and follow `meta.next` until it is null, or the bank list will be cut short.

### 6.3 Initializing with subaccount, bearer, and Fluta's fee

`POST https://api.paystack.co/transaction/initialize` [S2]:

| Parameter            | Value Fluta sends                                                                                                                                                | Source         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `amount`             | balance due in kobo, as a string ("subunit of the supported currency")                                                                                           | [S2]           |
| `email`              | the payer's email (required by Paystack)                                                                                                                         | [S2]           |
| `currency`           | `"NGN"` (`Store.currency`)                                                                                                                                       | [S2]           |
| `reference`          | Fluta-generated (6.4)                                                                                                                                            | [S2]           |
| `callback_url`       | the order's tracking page (6.5)                                                                                                                                  | [S2]           |
| `subaccount`         | `Store.paystackSubaccountCode`                                                                                                                                   | [S2][S3]       |
| `bearer`             | `"subaccount"` (Paystack's fees come from the store's share)                                                                                                     | [S2][S3]       |
| `transaction_charge` | Fluta's fee in kobo (see below)                                                                                                                                  | [S2][S3]       |
| `metadata`           | stringified JSON: `{ "payment_id": "…", "order_id": "…", "store_id": "…" }` plus `custom_fields` for the dashboard (order number only) and `cancel_action` (6.5) | [S2][S11][S26] |

`transaction_charge` is "an amount used to override the split configuration for a single split payment. If set, the amount specified goes to the main account regardless of the split configuration" [S2]. So Fluta's fee is set **per transaction** and the subaccount is never changed when a store's rate changes.

Fee calculation (pure, in `src/server/domain/online-payment.ts`):

```ts
// Fluta's share of one online payment: the store's rate in basis points
// (100 = 1%), rounded down to whole kobo so any rounding favours the store.
export function getFlutaFeeKobo(amountKobo: number, feeBps: number): number {
  return Math.floor((amountKobo * feeBps) / 10_000);
}
```

**Decided:** fees round down, favouring the store.

**At ₦0:** the subaccount is created with `percentage_charge: 0`, so Fluta gets nothing by default.

- **Recommendation:** still send `transaction_charge: 0` explicitly, so a later dashboard edit of the subaccount's percentage can never charge a 0% store
- ~~Whether Paystack accepts `transaction_charge: 0` is Unconfirmed.~~ **Confirmed in Phase 3 (23 October 2026, test mode):** Paystack accepts `transaction_charge: 0`. The verify response shows `fees_split.params.transaction_charge: "0"`, `integration: 0`, and the store's share reduced only by Paystack's fee (₦800 paid → ₦12 to Paystack, ₦788 to the subaccount). Fixture: `src/test/fixtures/paystack/verify-success.json`.
- Check in Phase 3. If it is refused, omit the parameter at 0% and, when connecting, assert that the fetched subaccount has `percentage_charge` 0 [S4].

**Confirmed in Phase 5 (26 October 2026, test mode, development database only):** two ₦1,600 Book and pay payments at FreshFold.

| FreshFold `onlineFeeBps` | `Payment.flutaFeeBps` / `flutaFeeAmount` | `transaction_charge` sent | Verify `fees_split` (kobo)                                         |
| ------------------------ | ---------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| 150                      | 150 / 2,400 (₦24)                         | 2,400                     | `paystack` 2,400, `integration` "2400", `subaccount` 155,200       |
| 0                        | 0 / 0                                     | 0                         | `paystack` 2,400, `integration` 0, `subaccount` 157,600            |

- Both show `bearer: "subaccount"` and `percentage_charge: "0"`. The store's share is `amount − Paystack's fee − transaction_charge`, as 6.10 expects. The owner saw the same split in the test dashboard (₦24 to Fluta, then ₦0).
- `fees_split.integration` is a string (`"2400"`) when non-zero and the number `0` at 0%. Fluta never reads it (the fee is copied onto `Payment` when the payment starts), so this needs no code change. Anything that reads it later must accept both.
- The first payment kept `flutaFeeBps` 150 and `flutaFeeAmount` 2,400 after the rate was set back to 0. FreshFold was left at 0.
- Fixtures (redacted): `src/test/fixtures/paystack/verify-success-fee-150.json` and `verify-success-fee-0.json`.

**Insufficient share:** "When specifying a bearer, you need to ensure that the amount that goes into the subaccount is sufficient to bear the transaction fee. If the amount is insufficient, you'll get a `400 Bad Request` error" [S3]. With a fee capped at 5% this should only affect tiny amounts. Treat it as a refusal ("This amount can't be paid online. Please pay the store directly.") and log it.

**Response:** `data.authorization_url`, `data.access_code`, and `data.reference` [S2].

**Multi-split is not needed.** Multi-split (`split` objects or `split_code`) shares one payment across several subaccounts with a `bearer_type` [S14]. Fluta always has exactly one subaccount (the store) plus the main account (Fluta), and single-subaccount split already covers that with `subaccount`, `bearer`, and `transaction_charge` [S3].

### 6.4 Fluta-generated references

- Format: `FL-` followed by 24 random base64url characters with `_` removed, or simpler, `FL-` + 20 random hex characters. Paystack allows "only `-`, `.`, `=` and alphanumeric characters" [S2].
- The reference reveals nothing: no order number, store, or phone.
- `Payment` row first: the reference is saved as `Payment.paystackReference` (unique) on a `PENDING` row **before** Paystack is called. It ties to the order through `Payment.orderId` and `storeId`.
- Paystack is told to use that reference, so every webhook and verify response leads back to exactly one `Payment` [S2].
- A new reference for every attempt. If a reference were reused, Paystack's behaviour (for example a duplicate-reference error) is **Unconfirmed**. One reference per attempt avoids the question.

### 6.5 The callback redirect

- After a successful payment, "Paystack will redirect the user back to a `callback_url` you set. We'll append the transaction reference in the URL", for example `…?reference=YOUR_REFERENCE` [S9]. The verify-payments page says the same [S8].
- "Just because the `callback_url` was visited doesn't prove that transaction was successful" [S9]. Fluta treats the return as a **hint to check**, never as confirmation.
- `callback_url` = `{BETTER_AUTH_URL}/o/{token}?paystack=return`. **Confirmed in Phase 3:** Paystack appends both `trxref` and `reference` (same value), giving `…?paystack=return&trxref=FL-…&reference=FL-…`. Fluta reads only `reference`.
- `metadata.cancel_action` = `{BETTER_AUTH_URL}/o/{token}`, the URL Paystack sends the customer to if they press cancel on checkout [S26]. This is documented on the mobile WebView guide. **Confirmed in Phase 3:** the standard redirect checkout honours it. "Cancel Payment" on checkout sends the customer straight to `/o/{token}`, with no parameters added.
- **Note on the privacy rule below:** `cancel_action` is itself a metadata value, so the raw token does sit in `metadata.cancel_action` (Paystack shows it back in verify responses). The other metadata values (`payment_id`, `order_id`, `store_id`, `custom_fields`) never hold it, and an integration test checks that.
- **Privacy note.** Both URLs carry the raw tracking token, which Paystack stores on the transaction. The token never appears in `metadata` values and is never logged.
- **Decided:** this is accepted. Paystack is the payment processor.
- **A link replaced during checkout.** Staff may resend the link (which issues a new token) while the customer is on Paystack's page. The customer then returns to the old link and sees the existing "This link may have been replaced by a newer message from the store" page, so the return-page verify can't run. No money is lost, because the webhook (or the reconciliation job, 7.1) still records the payment against the order. The customer sees it as soon as they open the new link. This is rare and accepted.

### 6.6 Server-side verification

`GET https://api.paystack.co/transaction/verify/:reference` with `Authorization: Bearer SECRET_KEY` [S2].

- `response.status` is the status of the API call, **not** of the payment. The payment's status is `response.data.status` [S8].
- `data.status` values: `abandoned`, `failed`, `ongoing`, `pending`, `processing`, `queued`, `reversed`, `success` [S8]
- Paystack's own checks: confirm `data.status` and `data.amount` before giving value [S9]

Fluta confirms a payment only when **all** of these hold:

| Check                             | Expected                                                    |
| --------------------------------- | ----------------------------------------------------------- |
| `data.status`                     | `"success"` [S8]                                            |
| `data.reference`                  | equals the `Payment.paystackReference` looked up [S2]       |
| `data.amount`                     | equals `Payment.amount` (integer kobo) [S2][S9]             |
| `data.currency`                   | `"NGN"` [S2]                                                |
| `data.domain`                     | `"test"` when `PAYSTACK_MODE=test`, `"live"` when live [S2] |
| `data.subaccount.subaccount_code` | equals the store's `paystackSubaccountCode`                 |

The `data.subaccount` object appears in verify responses, but the documented examples show it empty (`{}`) for non-split payments [S2]. **Confirmed in Phase 3:** for a split payment it is the full subaccount object, including `subaccount_code`, `percentage_charge`, and the settlement account (with the full account number, which Fluta never keeps). Verify also returns `fees` (Paystack's fee in kobo) and `fees_split` (`paystack`, `integration`, `subaccount`, and `params` with `bearer`, `transaction_charge`, and `percentage_charge`).

- **Recommendation:** check it when present, and record a real test-mode payload in Phase 3 to fix the schema
- Even without it, the reference was generated by Fluta and saved on a `Payment` with the store's ID, so a payment can't be credited to the wrong store

Also kept: `data.paid_at` becomes `confirmedAt`, and `data.fees` (Paystack's fee, kobo) [S2] is recorded for reconciliation if a column is added (see 9.1).

### 6.7 Webhooks

**Event needed:** `charge.success` only. Paystack "currently send[s] webhook events for just successful transactions" [S8]. The full event list includes `charge.success` and the `refund.*` events [S1]. All other events are acknowledged with 200 and ignored.

**Signature** [S1]:

- Header: `x-paystack-signature`
- Algorithm: `HMAC SHA512`, written as hex in Paystack's example
- Key: the **secret key** (the same `PAYSTACK_SECRET_KEY`)
- Input: the raw event payload. Paystack's Node example computes `crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex')` on the raw body captured before JSON parsing.
- "Verifying the header signature should be done before processing the event"

Route sketch:

```ts
// src/app/api/webhooks/paystack/route.ts
// Paystack's server-to-server events. Not a browser request: no Origin
// check and no session. The signature on the exact raw bytes is the only
// credential, so the body is read once as bytes, checked, and only then parsed.
export async function POST(request: Request): Promise<Response> {
  const config = getPaystackConfig();
  if (!config) return new Response(null, { status: 404 });

  const body = await readBodyWithLimit(request, WEBHOOK_MAX_BYTES); // 64 KB
  if (!body.ok) return new Response(null, { status: 400 });
  if (
    !isValidPaystackSignature(
      body.bytes,
      request.headers.get('x-paystack-signature'),
      config.secretKey,
    )
  ) {
    return new Response(null, { status: 401 });
  }

  const event = paystackEventSchema.safeParse(parseJson(body.bytes));
  if (!event.success) return new Response(null, { status: 200 }); // signed but not ours to handle
  try {
    await handlePaystackEvent(event.data, new Date());
    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error('[paystack-webhook] handling failed:', describeError(error));
    return new Response(null, { status: 500 }); // Paystack retries, and handling is idempotent
  }
}
```

```ts
// src/server/integrations/paystack.ts
export function isValidPaystackSignature(
  raw: Uint8Array,
  header: string | null,
  secretKey: string,
): boolean {
  if (!header || !/^[0-9a-f]{128}$/i.test(header)) return false;
  const expected = createHmac('sha512', secretKey).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header, 'hex'));
}
```

Reading bytes (not `request.text()`) and decoding only after the check avoids any change to the bytes. Next's own webhook example uses `request.text()` [S27], which would also work for UTF-8 JSON, but bytes are the safer choice.

**Response codes and retries** [S1]:

- Paystack treats anything other than `200 OK` as a failed attempt
- For long tasks, return 200 first and do the work afterwards. Fluta's work is a few quick database writes, so it stays inline.
- Live mode: "retried every 3 minutes for the first 4 tries, then retried hourly for the next 72 hours"
- Test mode: "retried hourly for the next 10 hours. The timeout for each attempt is 30 seconds"
- The URL must be public ("localhost URLs can't receive events")

**IP addresses.** Paystack sends webhooks only from `52.31.139.75`, `52.49.173.169`, and `52.214.14.220`, for both test and live [S1].

**Decided:** the signature is the gate. The IP list is not enforced for now. A correctly signed event from outside the list is logged as a warning, and enforcement is decided at launch (Feature 25). Two reasons:

- Railway's client-IP header is still unconfirmed (Feature 03 note: "Railway's client-IP header (`x-real-ip`) still to confirm"), so a wrong header would block real events
- Local testing through the CLI or a tunnel arrives from other addresses

Turn on enforcement in production only after confirming the header.

**Missed and resent events.** Paystack can list failed deliveries (`GET /integration/webhooks/events`) and resend them (`POST /integration/webhooks/events/resend`). Resending "isn't idempotent: submitting the same event id twice delivers it twice" [S18]. That is one more reason for 6.8.

### 6.8 Counting each payment exactly once

One service function confirms payments, called by the webhook, the return-page verify, and the reconciliation job:

```ts
// src/server/services/online-payments.ts
export async function confirmPaystackPayment(
  txn: PaystackTransaction,
  now: Date,
): Promise<ConfirmOutcome> {
  const payment = await findPaymentByReference(txn.reference); // unique paystackReference
  if (!payment) return { kind: 'UNKNOWN_REFERENCE' }; // not Fluta's, log and ignore
  const check = checkPaystackTransaction(payment, txn); // pure: status, amount, currency, domain, subaccount
  if (!check.ok) return recordMismatch(payment, check.reason, now);
  return markPaymentConfirmed(payment.storeId, payment.id, txn.paidAt ?? now); // one conditional update
}
```

Simplified sketch of the confirm step. The `where` shown here covers `PENDING` only. The real condition, which also allows some `FAILED` payments, is the full one under "The full condition" below.

```ts
// src/server/data/online-payments.ts. Inside one transaction.
// SIMPLIFIED: the real `where` is the full condition further down.
const updated = await tx.payment.updateMany({
  where: { storeId, id: paymentId, source: 'ONLINE', status: 'PENDING' },
  data: { status: 'CONFIRMED', confirmedAt },
});
if (updated.count === 0) return { kind: 'ALREADY_HANDLED' }; // a duplicate webhook, or webhook and verify racing
// The same transaction writes the timeline entry (AuditEvent ONLINE_PAYMENT_CONFIRMED).
```

- The conditional update (`PENDING` → `CONFIRMED`) is the lock. Two webhooks, or a webhook and a verify arriving together, cannot both see `count = 1`. This is the same pattern as message claiming (`QUEUED` → `SENDING`).
- The unique `paystackReference` means a reference can never become two payments
- A `FAILED` payment can still become `CONFIRMED` when Paystack later reports success (a late webhook after Fluta marked an abandoned attempt failed), because the money was really received. This is allowed **only when its `failureCode` is not a mismatch code**. A payment whose `failureCode` is `AMOUNT_MISMATCH`, `CURRENCY_MISMATCH`, `MODE_MISMATCH`, or `SUBACCOUNT_MISMATCH` is never confirmed automatically, however many times Paystack retries. The full condition:

```ts
// The mismatch codes (6.8, below): a payment failed with one of these stays
// for review and is never confirmed by a retried webhook or verify.
export const MISMATCH_CODES = ['AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'MODE_MISMATCH', 'SUBACCOUNT_MISMATCH'] as const;

const updated = await tx.payment.updateMany({
  where: {
    storeId,
    id: paymentId,
    source: 'ONLINE',
    OR: [
      { status: 'PENDING' },
      // notIn alone would skip NULL failure codes (SQL NOT IN never matches NULL), so NULL is listed too.
      { status: 'FAILED', OR: [{ failureCode: null }, { failureCode: { notIn: [...MISMATCH_CODES] } }] },
    ],
  },
  data: { status: 'CONFIRMED', confirmedAt },
});
```

  The pure check `checkPaystackTransaction` also runs first on every retry, so a retried event for a mismatched payment is refused twice over: by the check, and by the `where`.

**Mismatched payments (decided).** When `checkPaystackTransaction` refuses a successful Paystack transaction (wrong amount, currency, mode, or subaccount):

- `recordMismatch` sets the payment to `FAILED` with a `failureCode` from a fixed set (`AMOUNT_MISMATCH`, `CURRENCY_MISMATCH`, `MODE_MISMATCH`, `SUBACCOUNT_MISMATCH`), in one conditional update so it is recorded once
- It never counts in `getBalance`
- In the same transaction it writes `AuditEvent` `ONLINE_PAYMENT_NEEDS_REVIEW` (payment ID, reference, the expected and received amounts, and the code)
- After the commit, it emails `FLUTA_ALERT_EMAIL` with the store, order number, reference, and code. It sends no email to the store owner.
- The order detail page shows **"Payment needs review"** (a warning badge with text) on that payment, instead of hiding it like other `FAILED` attempts. The tracking page shows nothing new to the customer.
- Fluta resolves it by hand with Paystack and the store. A store-collected payment or a refund (Feature 18) settles the order.

### 6.9 A webhook for an order cancelled or fully paid in the meantime

- **Always record it.** The customer's money really arrived, and the store received it. Refusing to record it would hide money the store owes back.
- `getBalance` already does the rest: on a cancelled order the total counts as 0, and on a fully paid order the extra payment makes the balance negative. Both show **Refund owed**, and the tracking link stays valid while a refund is owed (`getTrackingLinkStatus`).
- Write the timeline entry "Online payment received after the order was cancelled" or "… after it was paid in full", so staff can see why a refund is owed. Refunds are recorded in Feature 18.
- The same applies when a revision changed the total between checkout and payment. The payment is recorded as charged, and the balance becomes whatever it now is.

### 6.10 How settlement splits

- With `bearer: "subaccount"`, Paystack's charges come out of the subaccount's share [S3]. With `transaction_charge`, the given flat amount goes to the main account (Fluta) [S2][S3].
- So the store receives `amount − Paystack fees − transaction_charge`, and Fluta receives `transaction_charge`. At ₦0, the store receives `amount − Paystack fees`.
- Paystack's Nigerian local pricing appears to be "1.5% + ₦100, capped at ₦2,000, with the ₦100 waived under ₦2,500", per Paystack's support pages found by search [S25]. The support page itself could not be opened, so treat the figures as **Unconfirmed**. Fluta never hard-codes Paystack's fees. It reads `data.fees` from the verify response [S2].
- **Test mode:** "settlements aren't processed in test mode" [S15]. In test mode Fluta can confirm only:
  - that initialize with `bearer: "subaccount"` and a `transaction_charge` succeeds
  - that the verify response's `fees` and any split fields match expectations
  - how the transaction looks in the test dashboard
- Actual payouts can only be proven in live mode, with a small real payment to a real store account. `GET /settlement?subaccount=…` lists settlements per subaccount [S19].

### 6.11 Refunds

- Paystack offers `POST /refund` with `transaction` (reference or id), an optional `amount` ("cannot be more than the original transaction amount"), and optional `customer_note` and `merchant_note` [S13]
- Statuses: `pending`, `processing`, `needs-attention`, `failed`, `processed`. A processed refund "may still take up to 10 business days" to reach the customer [S12].
- Webhook events: `refund.pending`, `refund.processing`, `refund.needs-attention`, `refund.failed`, `refund.processed` [S12][S20]
- For a split transaction, whose balance a refund comes from (Fluta's main account or the store's subaccount) is **Unconfirmed**. It is not covered in the refund pages read.

**Decided:** refunds stay outside Fluta for the MVP, as the overview says. The store refunds the customer directly, and staff record it in Feature 18. Using Paystack's refund API would pull money from Fluta's own Paystack balance unless Paystack deducts it from the subaccount, which is unconfirmed. Fluta would then hold refund risk for store decisions. Revisit after Paystack answers how split refunds are funded (Phase 0).

---

## 7. Starting a payment: the full flow

```text
Customer on /o/{token}         Fluta server                              Paystack
──────────────────────         ────────────                              ────────
Tap "Pay ₦6,200"   ──────────► startOnlinePayment(token, { email })
                               1. token → order (hash), link valid,
                                  canPayOnline(), amount = balance due
                               2. fee = getFlutaFeeKobo(amount, store.onlineFeeBps)
                               3. INSERT Payment PENDING (reference, amount,
                                  payerEmail, flutaFeeBps, flutaFeeAmount)
                               4. POST /transaction/initialize ─────────► authorization_url
                               5. on failure: Payment → FAILED, friendly error
Browser goes to checkout ◄──── { ok: true, checkoutUrl }
Pays on Paystack's page  ─────────────────────────────────────────────► charge.success webhook
                               confirmPaystackPayment() ◄─────────────── (signed)
Redirect to /o/{token}?paystack=return&reference=…
Page shows "Confirming your payment…" and calls
confirmReturnedPayment(token, reference) once ─► verify ───────────────► GET /transaction/verify/:ref
                               confirmPaystackPayment() (same function)
router.refresh() → updated balance from getBalance
```

- **Write first, call after.** Step 3 commits before step 4, as the standards require for integrations. If Paystack fails, the row is marked `FAILED` with a short code, and nothing counts.
- **The payer's email (decided).** The email entered at the payment step is pre-filled from `Customer.email` when there is one. It is always saved on the payment (`Payment.payerEmail`). It is saved on the customer **only if the customer has no email yet**, in the same transaction as step 3. It never overwrites an existing email, following Feature 13's rule (spec 13, line 50).
- **Repeated taps.** Each tap creates a new `PENDING` attempt with a new reference. Only confirmed ones count. If a customer pays twice in two tabs, both are recorded and the balance shows Refund owed, which is the truthful outcome. To reduce this, the button disables while starting, and the page hides Pay now while a recent attempt (under 15 minutes) is still `PENDING`, showing "A payment is being confirmed" with "Pay again" as a secondary link.
- **The return page.** The tracking page stays a server component that reads the order fresh. When `?paystack=return&reference=…` is present and that payment is still `PENDING`, it renders a small client component, `ConfirmingPayment`:
  - shows "Confirming your payment…"
  - calls `confirmReturnedPayment(token, reference)` once
  - if Paystack says `ongoing` or `pending`, retries twice more a few seconds apart
  - then calls `router.refresh()`
  - if still unconfirmed, says "We're still confirming your payment. This page will update once the store receives it." The webhook or the job will finish it.

  The action checks that the reference belongs to **this token's order** before verifying. The redirect itself never changes anything.

- **Closing checkout early.** No webhook comes (only successes are sent [S8]), so the attempt stays `PENDING` until the reconciliation job marks it `FAILED` when verify reports `abandoned` or `failed`.

### 7.1 Reconciliation job (backstop)

Add to the existing cron job (`runMessageJob` or a sibling called from `/api/cron/messages`):

- For `ONLINE` payments still `PENDING` after 30 minutes and created in the last 48 hours, call verify, at most 20 per run
- `success` → `confirmPaystackPayment`
- `abandoned` or `failed` → mark `FAILED`
- Anything still `PENDING` after 48 hours → `FAILED`, with a late webhook still able to confirm it (6.8)

This covers a webhook missed during a deploy and keeps the **Pending** state from sticking.

---

## 8. Files to create

| File                                                                                              | Purpose                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/integrations/paystack.ts`                                                             | The only Paystack caller: `listBanks`, `resolveAccount`, `createSubaccount`, `updateSubaccount`, `fetchSubaccount`, `initializeTransaction`, `verifyTransaction`, `isValidPaystackSignature`. Zod schemas for every response. `PaystackError` with short codes. A `PaystackClient` interface so tests inject a fake. |
| `src/server/domain/online-payment.ts`                                                             | Pure: `canPayOnline`, `getFlutaFeeKobo`, `checkPaystackTransaction` (amount, currency, domain, subaccount), `createPaystackReference` takes random bytes in.                                                                                                                                                         |
| `src/server/services/online-payments.ts`                                                          | `startPayment`, `confirmPaystackPayment`, `confirmReturnedPayment`, `handlePaystackEvent`, `reconcilePendingPayments`                                                                                                                                                                                                |
| `src/server/services/payment-settings.ts`                                                         | `getPaymentSettings`, `resolveSettlementAccount`, `connectSettlementAccount`, `changeSettlementAccount`, `savePayLater`                                                                                                                                                                                              |
| `src/server/data/online-payments.ts`                                                              | Store-scoped Prisma queries: create pending, conditional confirm, mark failed, find by reference, pending-for-reconciliation                                                                                                                                                                                         |
| `src/server/data/payment-settings.ts` (or extend `stores.ts`)                                     | Save and read the Paystack fields with conditional updates                                                                                                                                                                                                                                                           |
| `src/actions/online-payments.ts`                                                                  | `startOnlinePayment`, `confirmReturnedPayment` (token-based, guest)                                                                                                                                                                                                                                                  |
| `src/actions/payment-settings.ts`                                                                 | `resolveSettlementAccount`, `connectSettlementAccount`, `changeSettlementAccount`, `setPayLater` (owner, `requireOwnerCanEdit`)                                                                                                                                                                                      |
| `src/schemas/online-payments.ts`                                                                  | `startPaymentSchema` (email, trimmed, `z.email()`), `paystackEventSchema`, `paystackTransactionSchema`, `settlementAccountSchema` (bank code, 10-digit account number, business name)                                                                                                                                |
| `src/app/api/webhooks/paystack/route.ts`                                                          | The webhook (6.7)                                                                                                                                                                                                                                                                                                    |
| `src/app/(staff)/(workspace)/settings/payments/page.tsx`                                          | Settings → Payments                                                                                                                                                                                                                                                                                                  |
| `src/components/settings/PaymentSettingsCard.tsx`, `BankConnectionForm.tsx`, `PayLaterToggle.tsx` | Settings UI (client components, with the shared form-error scroll helper)                                                                                                                                                                                                                                            |
| `src/components/tracking/PayNowCard.tsx`, `ConfirmingPayment.tsx`                                 | Tracking page payment UI                                                                                                                                                                                                                                                                                             |
| Tests                                                                                             | see section 13                                                                                                                                                                                                                                                                                                       |

Settings action sketch:

```ts
export async function connectSettlementAccount(
  formData: FormData,
): Promise<SettingsActionResult<ConnectedAccount>> {
  const member = await requireOwnerCanEdit();
  if (!member.allowed)
    return { ok: false, message: ownerEditRefusalMessage(member, NOT_OWNER) };
  const parsed = connectAccountSchema.safeParse(
    pick(formData, [
      'businessName',
      'bankCode',
      'accountNumber',
      'confirmedAccountName',
    ]),
  );
  if (!parsed.success) return invalid(parsed.error.issues);
  try {
    return await connectAccount(
      member.store.id,
      member.user.id,
      parsed.data,
      new Date(),
    );
  } catch (error) {
    logger.error('[payment-settings] connecting failed:', describeError(error)); // never the account number
    return {
      ok: false,
      message: "We couldn't connect your bank account. Please try again.",
    };
  }
}
```

Settings → Payments layout (360px first):

```text
Store   Team   Payments
───────────────────────
Online payments                 [Connected]
GTBank · AMINA BELLO · •••• 4521
Connected 20 Oct 2026
Fluta fee: 0% of online payments
Paystack's fees are taken from each online payment before it reaches your bank.
[Change bank account]

Let customers pay later         [ toggle ]
Customers can book now and pay when they collect.
```

---

## 9. Files to modify and schema changes

### 9.1 Schema changes (one migration, Ask First)

Compared with the overview's draft:

| Model     | Change                                                                                                                        | Draft has it?                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `Store`   | `onlineFeeBps Int @default(0)` plus `CHECK ("onlineFeeBps" BETWEEN 0 AND 500)` in SQL (`--create-only`)                       | Yes (without the CHECK)                     |
| `Payment` | `flutaFeeBps Int?`, `flutaFeeAmount Int?`                                                                                     | Yes                                         |
| `Payment` | `paystackFeeAmount Int?` (Paystack's `fees` from verify, for reconciliation and support)                                                  | No. **Decided:** add it.              |
| `Payment` | `failureCode String?` (short code when an attempt fails or mismatches, see 6.8)                                                        | No. **Decided:** add it.              |
| `Payment` | CHECK: `source = 'ONLINE'` requires `method = 'PAYSTACK'` and a `paystackReference`, and `STORE_COLLECTED` forbids `PAYSTACK` | No. Recommended, mirrors Feature 16's rule. |
| `Payment` | `@@index([status, createdAt])` for the reconciliation job                                                                     | No                                          |

`clientRequestId` comes from Feature 16's migration. Migration name: `add_online_payments`.

### 9.2 Files to modify

| File                                                                                                  | Change                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/env.ts`, `.env.example`                                                                      | `PAYSTACK_SECRET_KEY`, `PAYSTACK_MODE`, the test-versus-live rules (5.4), `getPaystackConfig()` returning null when unset                             |
| `src/lib/env.test.ts`                                                                                 | Live key refused off production, mode and prefix must agree                                                                                           |
| `src/lib/logger.ts` (+ test)                                                                          | Redaction list additions (5.6)                                                                                                                        |
| `next.config.ts`                                                                                      | Ignore `/api/webhooks/` in request logs                                                                                                               |
| `src/server/domain/balance.ts` (+ test)                                                               | `PAYMENT_REQUIRED` and `PENDING` states (9.3)                                                                                                         |
| `src/lib/orders.ts`                                                                                   | Add the two states to `PAYMENT_STATES` and `PAYMENT_STATE_LABELS` ("Payment required", "Pending")                                                     |
| `src/server/data/orders.ts`                                                                           | Mirror the new states in the SQL payment filter. Keep the agreement integration test passing.                                                         |
| `src/lib/tracking.ts`                                                                                 | `getCustomerPaymentText` for the new states ("Payment due: ₦6,200", "Confirming your payment")                                                        |
| `src/server/services/tracking.ts`, `src/types/tracking.ts`                                            | Add `payment.action` (`PAY_NOW` with amount, pre-filled email, the warning line) when `canPayOnline` allows. Include pending-attempt info.            |
| `src/components/tracking/TrackingOrder.tsx`                                                           | Render `PayNowCard` and `ConfirmingPayment`                                                                                                           |
| `src/server/services/order-entry.ts` (`createOnlineOrder`)                                            | `payLater = !(connected && !store.payLaterEnabled && hasApprovedTotal)`                                                                               |
| `src/server/services/booking.ts`, `src/components/booking/ReviewStep.tsx` and the confirmation screen | Book and pay (3.2): the final button reads "Book and pay ₦X" and `submitBooking` starts the payment and returns the checkout URL. Email required on that path only. The review line changes to the Paystack wording, or stays "You'll pay the store later". The confirmation screen shows Pay now only when initialize failed.       |
| `src/components/settings/SettingsNav.tsx`                                                             | Add "Payments"                                                                                                                                        |
| `src/components/orders/OrderDetail.tsx`                                                               | Show online payments ("Paystack · confirmed 3:15 PM"). Show `PENDING` online attempts as "Awaiting confirmation" (not counted). Show mismatched attempts as "Payment needs review" (6.8). Keep hiding other `FAILED` attempts. |
| Feature 16's record-payment form (on the order detail page) | When the order has a `PENDING` online attempt, show a notice above the amount: "An online payment for this order is being confirmed." It reminds staff not to take the same money again at the counter. It is information only and never blocks recording. The order detail data gains `hasPendingOnlinePayment`. Integration test: the notice shows with a pending attempt and disappears once it is confirmed or failed |
| `src/server/domain/messages.ts` (`chooseDestinations`) and the booking's message queueing | `alwaysEmail` for the Book and pay order-link email (3.2). Unit test: email is added with email copies off only when `alwaysEmail` is true |
| `src/server/data/order-timeline.ts`                                                                   | "Online payment received: ₦X (Paystack)" entries, plus the "after cancelled" or "after paid" wording                                                  |
| `src/server/services/notifications.ts` / cron job                                                     | Call `reconcilePendingPayments`                                                                                                                       |
| `src/components/design-system/*`                                                                      | Show the new payment badges and the Pay now card with sample data                                                                                     |
| `prisma/seed/*` | No Paystack fields. The seed never sets a `paystackSubaccountCode`, in any phase: Paystack refuses payments for a code that doesn't exist. Both seeded stores (FreshFold and CleanWave) stay unconnected, so the seed has no online payments either. FreshFold is connected for real in test mode through the Phase 2 flow (its Verify step). Integration tests set up connected stores in their own setup, with the fake Paystack client. |

### 9.3 The two new payment states

`getBalance` gains the order's `channel` and `payLater`, and recognises `PENDING` payments, staying the single place states are decided:

- balance > 0 **and** a `PENDING` online payment exists → `PENDING` ("A payment has started but is not yet confirmed")
- balance > 0, **`channel = ONLINE`**, `payLater = false`, no confirmed payments, order not closed → `PAYMENT_REQUIRED`
- otherwise as now

**Required fix (from review).** Staff-entered orders (`COUNTER`, `PHONE`, `WHATSAPP`) are all created with `payLater = false` (`src/server/services/order-entry.ts:365`). Those customers were never asked to pay online, so they must keep showing **Outstanding**. That is why `PAYMENT_REQUIRED` also requires `channel = ONLINE`. Only online bookings that were meant to be paid at booking show **Payment required**. The SQL payment filter in `src/server/data/orders.ts` applies the same `channel` condition, and the unit and integration tests in 13.1 and 13.2 cover an unpaid counter order.

The reconciliation job keeps `PENDING` from sticking. Balance arithmetic does not change: pending payments never count.

---

## 10. Paystack dashboard setup

### 10.1 Test mode

1. Create Fluta's Paystack business account (business country Nigeria)
2. Settings → API Keys & Webhooks: copy the **test** secret key into `.env.local` as `PAYSTACK_SECRET_KEY`, with `PAYSTACK_MODE="test"`
3. Leave the **Test** Callback URL empty, because Fluta sends `callback_url` per transaction [S2]
4. Set the **Test** Webhook URL to the staging site: `https://{staging address}/api/webhooks/paystack` (Feature 16b). Local tunnel testing (11) can borrow it, but set it back to staging afterwards.
5. Record the main account's own settlement bank. Fluta's fee settles there.

### 10.2 Production (live)

1. Complete Paystack's business activation for live mode. The requirements are **Unconfirmed** (6.1).
2. Copy the **live** secret key into Railway only (`PAYSTACK_SECRET_KEY`, `PAYSTACK_MODE="live"`). Never into any `.env` file.
3. **Live** Webhook URL: `https://{production domain}/api/webhooks/paystack`
4. Leave the live Callback URL empty (per-transaction `callback_url`)
5. Enable two-factor sign-in for every Paystack dashboard user, and limit who can see live keys. **Unconfirmed** where these settings sit in the dashboard.

### 10.3 Keeping test and live apart

- Test and live have separate keys, webhook URLs, and data [S15]. Subaccounts made in test mode exist only there (`domain: "test"`) [S4].
- A store connected in development has a test subaccount code. Production stores must connect again in production, which the separate databases ensure.
- The webhook rejects events whose `data.domain` doesn't match `PAYSTACK_MODE` (6.6)

---

## 11. Local webhook setup

**Since Feature 16b,** the staging site receives Paystack test webhooks at a permanent address, so most testing needs no tunnel. Use the tunnel below only to test webhook code before it reaches staging, and set the Test Webhook URL back to staging afterwards.

### 11.1 Official Paystack CLI

- **Package:** `@paystack-oss/dev-cli`, from the official repository `PaystackOSS/paystack-cli`, which Paystack's developer-tools page links to [S21][S22][S28]
- An unrelated package named `paystack-cli` on npm belongs to a different repository. Do not install it.
- **Caution:** the npm "latest" tag is `1.0.0-nightly.0`, last modified April 2022, declaring Node `>=8.0.0` [S22]. Try it in Phase 1 and fall back to 11.2 if it fails.
- **Checked in Phase 1 (20 October 2026):** `1.0.0-nightly.0` installs and starts on Node 22.14 (`paystack --help` lists its commands). Reading its source (`src/commands/webhook.js`) shows:
  - `listen` takes the local address as a flag, not a positional argument: `webhook listen --forward localhost:3000/api/webhooks/paystack`. Without `--forward` it stops with an error.
  - it needs `login` first (Paystack email and password, typed by the account owner), and ngrok (the `ngrok` npm package downloads its binary on install)
  - it saves the current Test Webhook URL and puts it back on Ctrl+C. Check the dashboard anyway, in case the process is killed another way.
  - **`login` no longer works:** run by the account owner, it fails with "Unable to sign in, please try again in a few minutes / LOGIN ERROR: undef". So `webhook listen` and `webhook ping` can't be used. Use the tunnel (11.2) and real test-mode payments (11.3) instead: each successful test payment sends a real signed `charge.success`.

Steps [S21]:

```sh
npm install -g @paystack-oss/dev-cli
paystack            # opens the CLI prompt
login               # signs in to the Paystack account
```

`webhook listen` tunnels through ngrok and needs an ngrok auth token in `NGROK_AUTH_TOKEN` [S21]:

```sh
export NGROK_AUTH_TOKEN="…"     # from an ngrok account
npm run dev                      # http://localhost:3000
webhook listen --forward localhost:3000/api/webhooks/paystack   # the README shows it without --forward; the code requires it
```

The README says: "This command is only available in test mode, and by using this command, the CLI would automatically make changes to the Test Webhook URL set on your Paystack dashboard" [S21].

**Sources disagree.** The 2020 launch blog post says listening works "without … changing dashboard settings" [S23]. The repository README is the current official source, and this plan follows it: assume the Test Webhook URL **is** changed.

Health check with a sample `charge.success` [S21]:

```sh
webhook ping --domain test
```

The README's example uses `--domain live`, which pings the **live** webhook URL [S21]. Never use `--domain live` from a development machine. The blog post also shows `webhook ping --event transfer.success --domain test` [S23]. Whether `--event charge.success` is accepted is **Unconfirmed**.

**After local testing:** open the dashboard and set the Test Webhook URL back on purpose (to the staging URL, or empty). The CLI never touches the **live** webhook URL, since `listen` is test-mode only [S21]. Check the live URL is unchanged anyway.

A sample `charge.success` from `ping` will carry a reference Fluta never created. The route must answer 200 and log "unknown reference", which is a useful test in itself.

### 11.2 Fallback: Cloudflare Quick Tunnel

No account needed [S29]:

1. Install `cloudflared` from https://developers.cloudflare.com/tunnel/downloads/ [S29]
2. Run `npm run dev`, then `cloudflared tunnel --url http://localhost:3000` [S29]
3. Copy the printed `https://….trycloudflare.com` address. It changes every run and stops when the process stops [S29].
4. Dashboard → Test Webhook URL: `https://….trycloudflare.com/api/webhooks/paystack`
5. Make a test payment (11.3). Watch the dev server log for the webhook.
6. When done, stop `cloudflared` and set the Test Webhook URL back

Limits: no uptime guarantee, and up to 200 in-flight requests [S29]. Fine for testing only.

**Used in Phase 1 (20 October 2026):** a real test payment's `charge.success` reached the route through the tunnel and verified. Through the tunnel there is no `x-real-ip` header, so the IP check logs "unknown address" (expected, since IPs aren't enforced). Copy the tunnel address carefully: it changes on every run, and a stale address in the dashboard means Paystack sends nothing.

Also set `BETTER_AUTH_URL` to the tunnel address while testing the full redirect, so `callback_url` leads back through the tunnel, or test the redirect on `localhost` separately. Paystack redirects the browser, which can reach `localhost`. Only the webhook needs a public URL [S1].

### 11.3 Test cards [S10]

| Purpose                | Card                    | Expiry | CVV | Other                |
| ---------------------- | ----------------------- | ------ | --- | -------------------- |
| Success, no validation | 4084 0840 8408 4081     | 09/27  | 408 |                      |
| Success, PIN + OTP     | 5060 6666 6666 6666 666 | 09/27  | 123 | PIN 1234, OTP 123456 |
| Declined               | 4084 0800 0000 5408     | 09/27  | 001 |                      |
| Token not generated    | 5078 5078 5078 5078 53  | 09/27  | 082 | PIN 0000             |

The listed expiry dates (09/27) come from the docs as indexed and may be updated by Paystack.

---

## 12. Production setup

- **Live webhook URL:** `https://{production domain}/api/webhooks/paystack`
- **Railway variables:** `PAYSTACK_SECRET_KEY` (live) and `PAYSTACK_MODE="live"`. The env check refuses to start production without them, or with a test key.
- **Raw body:** nothing extra is needed. Next 16 route handlers read the raw request themselves [S27]. Railway's proxy forwarding the body unchanged is the expected behaviour but is **Unconfirmed**. Check it with one live-mode `webhook ping` against the **production** URL during launch, done deliberately and only then.
- **IP allowlist:** after confirming which header Railway sets for the client IP, decide whether to enforce Paystack's three addresses [S1] (6.7)

- **Timeout:** Paystack waits 30 seconds per attempt (test mode figure [S1]). Fluta's handler is well within that.
- Run `prisma migrate deploy` before the app starts (standing rule)
- **First live check:** connect one real store account, make a small real payment, and confirm:
  - the webhook confirmed it
  - verify shows `fees`
  - the settlement (`GET /settlement?subaccount=…`) shows the store's share and Fluta's `transaction_charge` [S19]

---

## 13. Testing checklist

### 13.1 Unit tests (Vitest)

- `isValidPaystackSignature`:
  - a recorded test-mode payload with its real header passes
  - one changed byte fails
  - a missing, short, non-hex, or wrong-key header fails
  - comparison is timing-safe
- Re-serialized JSON (parsed and stringified) fails, which proves the raw bytes are what count
- `getFlutaFeeKobo`: 0 bps → 0, 150 bps on ₦6,200 → 9,300 kobo, rounding down on odd amounts, the 500 bps cap
- `canPayOnline`: every refusal reason (not connected, deactivated, expired link, cancelled, no balance, awaiting quote, pending price update)
- `checkPaystackTransaction`: wrong amount, currency, domain, subaccount, or status is each refused
- `getBalance`: `PENDING` and `PAYMENT_REQUIRED` states, and that pending payments never change the balance
- `getBalance`: an unpaid `COUNTER` order (and `PHONE` and `WHATSAPP`) with `payLater = false` stays `OUTSTANDING`, never `PAYMENT_REQUIRED`
- `getFlutaFeeKobo` rounds down
- `paystackEventSchema` and `paystackTransactionSchema` on recorded payloads (success, unknown event, missing fields)
- `env.ts`: live key refused outside production, mode and prefix must agree, unset allowed in development
- Logger: account numbers, emails, and `authorization` objects are redacted

### 13.2 Integration tests (Neon test branch, fake Paystack client)

- Duplicate webhooks: the same signed `charge.success` posted twice → one `CONFIRMED` payment, one timeline entry
- Webhook and verify racing: run `confirmPaystackPayment` twice with `Promise.all` → exactly one update succeeds
- A retried webhook never confirms a mismatched payment: a payment failed with each mismatch code (`AMOUNT_MISMATCH`, `CURRENCY_MISMATCH`, `MODE_MISMATCH`, `SUBACCOUNT_MISMATCH`) stays `FAILED` when the same signed `charge.success` is posted again, and also when a corrected, matching transaction is passed straight to the confirm update. The balance is unchanged, and no second alert is sent.
- A `FAILED` payment with no failure code (an abandoned attempt) or a non-mismatch code (for example a failed initialize) is confirmed by a later success
- Book and pay: a fixed-price booking at a connected store with pay later off creates one order with `payLater = false` and one `PENDING` payment, and returns the checkout URL. A failed initialize still saves the order (Payment required) and returns its link. A double tap with the same request ID makes one order. Without an email the booking is refused with a field error. A store with pay later on, or one not connected, gets no payment and no required email.
- Book and pay link email: an abandoned Book and pay booking (checkout never completed, the payment left `PENDING` and then `FAILED` by the job) still has a `LINK_CREATED` `EMAIL` message queued to the email entered at booking, **with the store's email copies setting off**. Checked with the fake mailer that it is sent. An ordinary booking at the same store with email copies off queues no email.
- Book and pay repeated submit: submitting again with the same request ID while the order's `PENDING` attempt is under 15 minutes old returns the order link, creates no second `Payment`, and makes no initialize call (the fake client records one call in total). With the clock moved past 15 minutes, the same submit starts a new attempt.
- A mismatched amount is refused: the payment is not confirmed, `failureCode` is `AMOUNT_MISMATCH`, an audit event is written, `FLUTA_ALERT_EMAIL` gets one alert (the fake mailer), the order shows "Payment needs review", and the balance is unchanged. A repeated webhook for it changes nothing and sends no second alert.
- An unpaid staff-entered counter order shows Outstanding in the orders list filter and on the detail page, not Payment required
- The payer's email fills an empty `Customer.email` but never replaces an existing one, and is always on `Payment.payerEmail`
- Changing bank details with a wrong password is refused, and nothing reaches Paystack (the fake client records no call)
- A cancelled order's late payment: the order is cancelled after checkout starts, then the webhook arrives → payment confirmed, state `REFUND_OWED`, the link stays valid
- A fully paid order's extra payment → `REFUND_OWED`
- Unknown reference → 200 and nothing written
- Bad signature → 401 and nothing written
- Starting a payment:
  - writes `PENDING` before calling the client
  - a client failure leaves it `FAILED`
  - the amount is the balance due
  - the fee is copied
- Isolation:
  - a CleanWave token can't start or confirm a payment on a FreshFold order
  - a reference from FreshFold can't confirm through CleanWave's tracking token
  - a FreshFold owner can't change CleanWave's bank details
- Not connected: no Pay now, `startOnlinePayment` refused, bookings created `payLater = true`
- Connected with pay later off: fixed-price booking `payLater = false` → `PAYMENT_REQUIRED`
- Settings:
  - owner-only (staff and rider refused)
  - resolve mismatch refused
  - change writes an audit event and emails the owner
  - a double connect leaves one subaccount saved
- The SQL payment filter still agrees with `getBalance` for the new states
- Reconciliation: `abandoned` → `FAILED`, `success` → confirmed once

### 13.3 End-to-end in test mode (manual, then Playwright for launch)

- Success with 4084 0840 8408 4081 [S10]: the return page shows "Confirming your payment…", then Paid
- PIN + OTP card [S10]: same result
- Declined card [S10]: no payment counted, Pay now available again
- Close checkout without paying: stays Payment required or Outstanding, never Paid. The job marks the attempt `FAILED`.
- Return with the webhook blocked (tunnel stopped): verify on return confirms it. Restart the tunnel and the retried webhook changes nothing.
- `webhook ping --domain test` [S21]: 200, logged as unknown reference
- Check both themes at ~360px and desktop: Settings → Payments, the Pay now card, and the confirming state

### 13.4 The overview's Paystack test-mode checklist

| Overview item                                                                                               | How it is checked                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank list, account-name resolution, and subaccount creation work end to end                                 | Phase 2: connect FreshFold in test mode. Resolve test-mode behaviour is **Unconfirmed** (6.1).                                                 |
| A transaction with the subaccount and `bearer: "subaccount"` deducts Paystack's fees from the store's share | Phase 3: verify shows `fees`, and the split fields show the subaccount bearing them. Real deduction is only visible in live settlements [S15]. |
| Webhook signatures are verified, and duplicate webhooks do not double-count                                 | Phase 4 unit and integration tests, plus resending a test event [S18]                                                                          |
| A customer closing checkout early leaves the payment unconfirmed                                            | Phase 3 and 4 manual test above                                                                                                                |
| Above 0%, Fluta's share reaches Fluta and the rest reaches the store. At 0% the store receives everything   | Test mode shows the configured split only. Final proof is the first live payment (12).                                                         |

**Test-mode results (Phase 5, 26 October 2026):** the last row is checked as far as test mode allows. At 150 bps a ₦1,600 payment split ₦24 to Fluta (`integration`), ₦24 to Paystack, and ₦1,552 to FreshFold's subaccount. At 0% it split ₦0 to Fluta, ₦24 to Paystack, and ₦1,576 to the store. The verify responses (6.3) and the test dashboard agree. Real payouts still need the first live settlement (Phase 6). The second row is also confirmed again: Paystack's fee came from the store's share in both cases.

---

## 14. Implementation order

Each phase ends in test mode with its checks passing before the next starts.

### Phase 0: Accounts, keys, and answers

- **Before starting:** Feature 16 is merged to `main`.

- **Build:** none. Create the Paystack account. Get test keys. Ask Paystack support about:
  - live activation requirements
  - test-mode account resolution
  - `transaction_charge: 0`
  - how refunds on split transactions are funded
- **Verify:** test key works (`GET /bank` from a terminal [S5])
- **Ready for next phase when:** the open Paystack answers are recorded in this document

### Phase 1: Foundation and local webhooks

- **Before starting:** Feature 16 is merged to `main`. Neither Phase 0 nor Phase 1 starts before that.
- **Build:**
  - the migration (9.1)
  - `coding-standards.md` Error Handling updated to the built `{ ok, message, fieldErrors? }` action result (decision 10)
  - `env.ts` variables
  - `integrations/paystack.ts` with `listBanks` and `isValidPaystackSignature`
  - the webhook route acknowledging events and logging the event name
- **Verify:**
  - CLI or tunnel set up (11)
  - `webhook ping --domain test` reaches `localhost` with a valid signature
  - a tampered body is refused
- **Ready for next phase when:** a real Paystack-signed request verifies locally, and the Test Webhook URL has been set back

### Phase 2: Bank connection

- **Build:** Settings → Payments, resolve, connect, change, pay-later toggle, audit event, owner email
- **Verify:** connect FreshFold in test mode. Fetch the subaccount to confirm `percentage_charge` is 0 [S4]. Change the bank, and see the audit entry and email.
- **Ready for next phase when:** a test subaccount code is saved, and its details match

### Phase 3: Starting payments

- **Build:**
  - `startPayment` and initialize
  - Pay now on the tracking page
  - **Book and pay** (3.2, decision 13): the "Book and pay ₦X" button for fixed-price bookings at a connected store with pay later off, which creates the order and goes straight to Paystack in one step, with email required on that path and Pay now on the confirmation screen if initialize fails
  - the return page: "Confirming your payment…" while the payment is still `PENDING` (nothing is confirmed in this phase)
  - `verifyTransaction` in the Paystack client, used only to record real responses as fixtures
  - the warning line
- **Verify (decided 23 October 2026: payment confirmation stays entirely in Phase 4):**
  - Pay now on an order link reaches Paystack's checkout, and test cards can be used there
  - book and pay at FreshFold with pay later off: one tap reaches Paystack's checkout
  - the `PENDING` `Payment` row is saved before Paystack is called
  - after paying, the return page shows "Confirming your payment…" and the payment is still `PENDING`
  - book at a store with pay later on: the button reads "Book", no checkout opens, and the email stays optional
  - record Paystack's real initialize, verify, and webhook responses and save them as test fixtures
  - answer the open questions: whether `transaction_charge: 0` is accepted, whether `cancel_action` works, the callback parameter names, and the shape of `data.subaccount` in a split verify response
- **Ready for next phase when:** payloads are recorded, and the subaccount and fee fields in them are known

### Phase 4: Webhook and verify processing

- **Build:** `confirmPaystackPayment`, verify on return (`confirmReturnedPayment` from the return page), mismatch handling, late payments, reconciliation job, timeline entries, the new payment states in `getBalance` and SQL
- **Verify:**
  - every integration test in 13.2. The webhook and the return verify both run on one payment.
  - book and pay at FreshFold with pay later off, then pay: the order page shows Paid (moved from Phase 3)
  - book and pay, then cancel or close checkout: the order exists, shows Payment required to staff, and Pay now on its link completes the payment (moved from Phase 3)
- **Ready for next phase when:** duplicates count once, and mismatches are refused

### Phase 5: The Fluta fee split

- **Build:** fee from `onlineFeeBps` on every transaction, copied to `Payment`. Set FreshFold to 150 bps in development by SQL.
- **Verify:** the verify response and test dashboard show `transaction_charge` going to the main account. The store share is reduced by the fee and Paystack's fees. At 0 the store gets everything except Paystack's fees.
- **Ready for next phase when:** the split is confirmed as far as test mode allows

### Phase 6: Production

- **Build:**
  - live keys in Railway
  - live webhook URL
  - IP-header check
  - optional enforcement
- **Verify:** one small live payment to a real store account, then check the webhook, verify, and settlement (12)
- **Ready for next phase when:** the first live settlement matches

---

## 15. Risks

- **Payout redirection.** Anyone with an owner's session can change where money goes. Mitigations:
  - owner-only
  - resolve-and-confirm
  - audit entry
  - email to the owner's sign-in address
  - password re-entry (decided, 4.3)
- **Tracking token sent to Paystack** in `callback_url` (6.5). Paystack is the payment processor and the token is never in metadata or logs, but it now lives outside Fluta.
- **The CLI is old** (2022 nightly, ngrok-based) and rewrites the Test Webhook URL [S21][S22]. The tunnel fallback (11.2) removes the dependency.
- ~~Unconfirmed `transaction_charge: 0`~~ (6.3). Confirmed accepted in Phase 3.
- **Refund funding on split transactions** is unconfirmed (6.11). This is a reason to keep refunds outside Fluta.
- **Missed webhooks** during deploys. Covered by verify on return, the reconciliation job, and Paystack's retries [S1].
- **Tiny amounts** may fail the "subaccount share sufficient" rule [S3]. Handled as a friendly refusal.
- **Live activation timeline** is unknown (6.1) and may delay Phase 6.
- **Pricing figures** are unconfirmed [S25]. Store-facing text says "Paystack's fees" without numbers.

## 16. Decisions (approved 20 October 2026)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Tracking link in Paystack's `callback_url` | Accepted. Paystack is the payment processor, and the link is never in metadata or logs (6.5) |
| 2 | Save the payer's email on the customer | Only when the customer has no email yet, never overwriting (Feature 13's rule). Always kept on `Payment.payerEmail` (7) |
| 3 | Auto-cancel unpaid "pay now" bookings | No. Staff decide, and the orders show Payment required (3.2) |
| 4 | Fee rounding | Round down, favouring the store (6.3) |
| 5 | Password re-entry to change bank details | Yes (4.3) |
| 6 | Limit Paystack's payment channels | No. Paystack's defaults apply (3.6) |
| 7 | Enforce Paystack's IP addresses | Not yet. Log a warning only, and decide at launch (6.7) |
| 8 | Alerts for mismatched payments | `FLUTA_ALERT_EMAIL`, plus "Payment needs review" on the order for staff. No email to the owner (6.8) |
| 9 | `paystackFeeAmount` and `failureCode` columns | Add both (9.1) |
| 10 | Action result shape | Keep the built `{ ok, message }`, and update `coding-standards.md` to match in Phase 1 (2.8) |
| 11 | Who sets the fee before Feature 23 | Nobody. It stays 0% (4.6) |
| 12 | Refunds through Paystack | Stay outside Fluta for the MVP, pending Paystack's answer on split refunds (6.11) |
| 13 | Paying at booking | For fixed-price bookings at a connected store with pay later off, the final button reads "Book and pay ₦X". It creates the order and goes straight to Paystack in one step. If the customer leaves checkout, the order stays as Payment required and can be paid from the order link (3.2, Phase 3) |

**Required fix from review:** `PAYMENT_REQUIRED` applies only to `ONLINE` orders, so staff-entered orders keep showing Outstanding (9.3).

**Confirmed:** `DATABASE_BRANCH` exists in `src/lib/env.ts` (line 15) and is used, with `NODE_ENV`, to detect production for the key rules (5.4).

**Gate:** Phase 0 and Phase 1 start only after Feature 16 is merged.

---

## Sources

Paystack pages were read through Context7's index of `paystack.com/docs` (`/websites/paystack`), because the site refuses direct fetches (HTTP 403).

- [S1] Webhooks: https://paystack.com/docs/payments/webhooks/
- [S2] API reference, Transactions (Initialize, Verify): https://paystack.com/docs/api/transaction/
- [S3] Split Payments: https://paystack.com/docs/payments/split-payments/
- [S4] API reference, Subaccounts (Create, Update, Fetch): https://paystack.com/docs/api/subaccount/
- [S5] API reference, Miscellaneous (List Banks): https://paystack.com/docs/api/miscellaneous/
- [S6] API reference, Verification (Resolve Account): https://paystack.com/docs/api/verification/
- [S7] Verify Account Number: https://paystack.com/docs/identity-verification/verify-account-number/
- [S8] Verify Payments: https://paystack.com/docs/payments/verify-payments/
- [S9] Accept Payments: https://paystack.com/docs/payments/accept-payments/
- [S10] Test Payments: https://paystack.com/docs/payments/test-payments/
- [S11] Metadata: https://paystack.com/docs/payments/metadata/
- [S12] Refunds: https://paystack.com/docs/payments/refunds/
- [S13] API reference, Refunds: https://paystack.com/docs/api/refund/
- [S14] Multi-split Payments: https://paystack.com/docs/payments/multi-split-payments/
- [S15] API reference, Authentication (test and live modes): https://paystack.com/docs/api/authentication/
- [S16] API reference, Errors: https://paystack.com/docs/api/errors/
- [S17] API reference, Rate limits: https://paystack.com/docs/api/rate-limits/
- [S18] API reference, Webhook Events (list, resend): https://paystack.com/docs/api/webhook-events/
- [S19] API reference, Settlements: https://paystack.com/docs/api/settlement/
- [S20] API changelog (December 2021, refund statuses and events): https://paystack.com/docs/changelog/api/
- [S21] Paystack CLI repository README: https://github.com/PaystackOSS/paystack-cli
- [S22] npm registry entry for `@paystack-oss/dev-cli`: https://www.npmjs.com/package/@paystack-oss/dev-cli
- [S23] Introducing the Paystack CLI (blog): https://paystack.com/blog/product/cli (read through a search summary, not opened directly)
- [S24] Older Split Payments page (docs-v2): https://docs-v2.paystack.com/payments/split-payments/
- [S25] Transactions pricing (support): https://support.paystack.com/en/articles/2130306 (read through a search summary only, so the figures are Unconfirmed)
- [S26] Using the Paystack Checkout in a Mobile WebView (`cancel_action`): https://paystack.com/docs/guides/using_the_paystack_checkout_in_a_mobile_webview/
- [S27] Next.js 16 docs, Route Handlers, Webhooks: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
- [S28] Developer Tools (links the CLI repository): https://paystack.com/docs/developer-tools/
- [S29] Cloudflare Quick Tunnels: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/

Moved links: none found. The Paystack URLs in the brief all matched the URLs in the index.
