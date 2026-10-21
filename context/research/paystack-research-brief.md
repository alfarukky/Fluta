# Paystack Integration Research

## Output

`context/docs/paystack-integration-plan.md`

**Research and plan only.** Do not write or change any code, schema, settings, or Paystack dashboard configuration. Save the plan and wait for approval.

## Research

Analyze the codebase and Paystack's official documentation to create a complete plan for taking online payments through Paystack in Fluta: connecting each store's bank account as a Paystack **subaccount**, letting customers pay from their order page, confirming payments by webhook and server-side verification, and the optional **Fluta fee** on online payments (default 0%).

Use Paystack's **official** documentation and repositories as the source of truth (check with Context7 and the web), and cite a source for every endpoint, parameter, header, and command. Where sources disagree, say so and follow the official one. Mark anything you could not confirm as **Unconfirmed**. Never guess.

### Official Paystack documentation (the source of truth)

Start from these pages and follow their links. Prefer them over any other source, including blog posts, third-party articles, and memory:

- Documentation home: https://paystack.com/docs/
- API reference (endpoints and parameters, including the Transaction, Subaccount, Miscellaneous → List Banks, Verification → Resolve Account Number, and Refund sections): https://paystack.com/docs/api/
- Accept Payments: https://paystack.com/docs/payments/accept-payments/
- Verify Payments: https://paystack.com/docs/payments/verify-payments/
- Webhooks: https://paystack.com/docs/payments/webhooks/
- Split Payments (subaccounts): https://paystack.com/docs/payments/split-payments/
- Multi-split Payments (to confirm it is **not** needed): https://paystack.com/docs/payments/multi-split-payments/
- Test Payments (test cards and test bank details): https://paystack.com/docs/payments/test-payments/
- Metadata: https://paystack.com/docs/payments/metadata/
- Refunds: https://paystack.com/docs/payments/refunds/
- Verify Account Number: https://paystack.com/docs/identity-verification/verify-account-number/
- Paystack CLI (local webhook testing): https://paystack.com/blog/product/cli and https://github.com/PaystackOSS/paystack-cli

If a link has moved, find the page from the documentation home and note the new address in the plan. Every claim in the plan cites the page it came from. Don't use a Paystack MCP server for this research.

Read first:

- @context/project-overview.md (Core Features → Payments, Payment states, Monetization → the optional fee, Next Steps → Paystack test-mode checklist)
- @context/coding-standards.md (Security → Paystack, Database, Money, Notifications)
- @context/features/00-roadmap.md (Feature 17, including the anti-fraud rules)
- @context/features/10-orders-list-and-detail-spec.md, @context/features/14-guest-tracking-and-approvals-spec.md, and @context/features/16-store-collected-payments-spec.md

## Include

### Current State Analysis

- The `Payment` model as built (status, source, method, `paystackReference`, `payerEmail`, `confirmedAt`, void fields, `clientRequestId`) and whether the optional fee fields (`flutaFeeBps`, `flutaFeeAmount`) exist yet
- The `Store` fields for Paystack (`paystackSubaccountCode`, settlement bank fields, `paystackConnectedAt`, `payLaterEnabled`, `onlineFeeBps` if added)
- `getBalance` and its states, and where it is used (order detail, tracking page, Payments page)
- How Feature 16 records payments (request IDs, transactions, audit events, timeline entries), to reuse for online payments
- The customer order page from Feature 14 (`/o/[token]`): token checks, headers, how actions are made, and where "Pay now" would go
- The booking flow from Feature 13: online orders are currently all created as pay later
- Any existing payment-related code, environment variables, or placeholders

### Payment Availability Analysis

- When an order can be paid online: the store is connected to Paystack, the order has an approved price with a balance due (`getBalance` shows Outstanding), the order is not cancelled, the link is valid, and the store is not deactivated
- Fixed-price online bookings: "Pay now" at booking versus pay later (`payLaterEnabled`), per the overview
- Orders that need a price from the store: paid only after approval
- Part payments: whether online payments always pay the full balance due (recommend)
- Stores not yet connected: no "Pay now" anywhere, as the overview requires

### Owner Settings Analysis

- Where Settings → Payments fits (Feature 05's settings and Feature 07's shared edit check)
- The bank connection flow from the overview: choose bank, resolve the account name, owner confirms, create the subaccount, show Connected. Changing bank details later, with an audit entry and an email to the owner
- Showing the store's current Fluta fee ("Fluta fee: 0% of online payments")

### API and Webhook Patterns

- How API routes are structured (`src/app/api/...`) and where the webhook route belongs (the coding standards name `src/app/api/webhooks/paystack/route.ts`)
- Server action error handling patterns (`{ success, data, error }`) and how they apply to starting a payment
- Environment variable patterns (`src/lib/env.ts`, `.env.example`), and how test and live keys stay apart across `.env.local`, `.env.test`, and Railway
- The integration boundary: Paystack is called only from `src/server/integrations/paystack.ts`
- Logging and redaction (`src/lib/logger.ts`): what must never be logged

### Paystack Questions to Answer

1. What works in test mode immediately, and what needs live business verification
2. Bank list, account-name resolution, and subaccount creation: endpoints, required fields, and responses. How subaccounts behave in test mode
3. Initializing a transaction with `subaccount`, `bearer: "subaccount"`, and Fluta's fee set **per transaction** from the store's current rate (including ₦0), without changing the subaccount. Amounts in kobo
4. Fluta-generated transaction references, and how each ties to an order and a `Payment`
5. The callback redirect, and why it never confirms a payment
6. Server-side verification: which fields prove success, and checking amount, currency, and subaccount against what Fluta expected
7. Webhook events needed, signature verification (header, algorithm, key, raw body), required response codes, retries, and whether to also check Paystack's sending IP addresses
8. Counting each payment exactly once when webhooks repeat, or a webhook and a verify both arrive, using the unique `paystackReference`
9. A webhook arriving for an order that was cancelled or fully paid in the meantime
10. How settlement splits: the store receives the payment minus Paystack's fees (charged to the subaccount) and minus Fluta's fee when above 0%. How to confirm this in test mode
11. Paystack's refund API: what it offers, and whether the MVP needs it (the overview says stores refund outside Fluta). Recommend, don't decide

## Deliverable

A complete implementation plan with:

- **Files to create**, with short code examples (integration functions, the webhook route, the payment action, the Settings → Payments screen)
- **Files to modify**, with the specific changes (the tracking page, the booking flow, `getBalance` callers, `env.ts`, the logger redaction list)
- **Schema changes** expected, compared with the overview's `Payment` and `Store` models
- **Paystack dashboard setup steps** for test mode and for production (keys, webhook URLs)
- **Local webhook setup** with the official Paystack CLI: confirm the current package name, install, login, `webhook listen` to the local route, `webhook ping`, and that it changes the Test Webhook URL in the dashboard. Plus one fallback (for example Cloudflare Tunnel or ngrok), with steps
- **Production setup:** the live webhook URL, live keys in Railway, and anything Railway needs (for example raw body access)
- **Testing checklist:** unit tests (signature checks with recorded payloads, amount and fee calculations), integration tests (duplicate webhooks counted once, webhook and verify both arriving, a mismatched amount refused, a cancelled order's late payment handled), end-to-end checks with Paystack's test cards and the CLI's test events, and the overview's Paystack test-mode checklist
- **Implementation order** in phases, each with what is built, how it is verified in test mode, and what must be true before the next phase. For example: accounts and keys, local webhook receiving, bank connection, starting payments, webhook and verify processing, the fee split, then production
- **Risks and open questions** for the project owner
- **Sources**, listed at the end

## Notes

These are Fluta-specific points the plan must take into account:

- **Raw body for signatures.** The webhook signature is checked against the exact raw request body. In a Next.js route handler, read the body as text first, verify the signature, and only then parse it. Parsing first and re-serializing can change the bytes and break verification
- **The webhook route is not a browser request.** Feature 05's upload route refuses requests without an `Origin` header, and workspace routes require a signed-in session. The webhook route must not inherit either check. Its only protection is the signature (and, if recommended, Paystack's IP addresses)
- **Customers have no session to refresh.** Unlike apps with signed-in users, a customer returning from checkout lands on their order page (`/o/[token]`), which reads the order fresh from the database on every load. On return, the page should call server-side verification once to speed things up, show "Confirming your payment…" until the payment is recorded, then show the updated balance. The redirect itself never marks anything paid
- **One source of truth for money.** A confirmed online payment is a `Payment` row (`source = ONLINE`, `method = PAYSTACK`). The order's state changes only through `getBalance`. No separate "paid" flag
- **The CLI changes dashboard settings.** Paystack's CLI `webhook listen` changes the Test Webhook URL in the dashboard. After local testing, the test webhook URL must be set back deliberately, and the live webhook URL is never touched by the CLI
- **Plain language and no semicolons** in the plan's written text
