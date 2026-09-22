# ICICI Bank Orange PG (Direct Orange) Integration

Status: **PRODUCTION Initiate Sale confirmed working end-to-end against the real bank.** A live production Initiate Sale request (real `ICICI_PROD_*` credentials, real ₹2.00 test amount) was accepted by ICICI (`R1000`), the redirect was validated and followed, and the browser reached ICICI's real hosted Direct Orange payment page. This is the first genuine, non-simulated confirmation this integration has ever had. The payment itself was **not** completed (deliberately stopped at the hosted page). UAT's own gateway was separately observed down (`502`, bank-side infrastructure) during this integration's development and was never completed end-to-end — production is now the confirmed-working path. No secret values appear anywhere in this document — see `.env.example` for variable names only.

**What this does and does not prove**: confirmed — production credentials, hash generation, the Initiate Sale request shape, and the redirect-host allow-list are all correct as of commit `3399d39`. **Not yet confirmed**: the return/callback leg against a real bank callback (no real customer has completed a payment yet), STATUS/reconciliation against a real bank response, and — critically — **the amount is still the fixed ₹2.00 UAT/demo value, not real order pricing** (see §5). Do not treat this as "ready for real customer payments" until §5's pricing gap is closed.

## 1. Architecture

```
Browser (Prezenti payment page)
  -> POST /api/payments/icici/initiate            (Vercel serverless function)
       -> validates input
       -> generates merchantTxnNo, txnDate server-side
       -> resolves the authoritative amount (fixed UAT test amount — see §5)
       -> persists an INITIATED row in payment_transactions (Supabase)
       -> builds the Direct Orange PG JSON request + secureHash
       -> POSTs to ICICI UAT Initiate Sale
       -> validates the response (never trusts responseCode alone)
       -> updates the row, returns only safe fields to the browser
  -> browser redirects (window.location) to the validated redirectURI
Customer completes/cancels/fails the payment on ICICI's hosted page
ICICI -> Prezenti return/callback: POST /api/payments/icici/return
       -> confirmed transport: browser POST, application/x-www-form-urlencoded
       -> secureHash is cryptographically verified (ICICI Hash Calculation V1 — see §8)
       -> only a verified payload can reach SUCCESS/PENDING/FAILED; anything
          else (bad shape, hash mismatch) stays UNKNOWN
       -> records receipt idempotently, redirects to a fixed internal path
Browser -> GET /api/payments/icici/status?merchantTxnNo=...
       -> reads the server-authoritative status; browser never decides this
(ops/frontend, on a stuck/pending transaction)
  -> POST /api/payments/icici/reconcile           (merchantTxnNo only)
       -> skips the bank call entirely if already locally SUCCESS
       -> otherwise calls ICICI Command STATUS, verifies secureHash,
          correlates merchantTxnNo, persists ONLY on a verified match
       -> returns the same safe public status shape as /status, plus
          a `reconciled` flag
```

All ICICI credentials, the Supabase secret key, and all cryptographic operations are server-side only, inside `api/_lib/payments/icici/` and the four route handlers under `api/payments/icici/` (`initiate.ts`, `return.ts`, `status.ts`, `reconcile.ts`). Nothing in that tree is imported by any file under `src/` (the Vite/browser bundle), so none of it can leak into the frontend build.

## 2. Environment configuration

Server-side only. Never set any of these as `VITE_*`/`NEXT_PUBLIC_*`/`PUBLIC_*`.

| Variable | Purpose | Notes |
|---|---|---|
| `ICICI_ENV` | `uat` (default) or `production` — matched exactly, case-sensitively; no other value/casing is normalized | `production` additionally requires `ICICI_PRODUCTION_CONFIRM` (below) — see §4a. **Do not set `ICICI_ENV=production` in any real environment** — see §4a for why this remains unsafe to actually use right now, independent of it being code-supported. |
| `ICICI_PRODUCTION_CONFIRM` | unset by default | The deliberate second gate for `ICICI_ENV=production` — see §4a. Leave unset. |
| `ICICI_PROD_MERCHANT_ID` / `ICICI_PROD_AGGREGATOR_ID` / `ICICI_PROD_HASH_KEY` | unset by default | Real, bank-issued ICICI **production** credentials — entirely separate from the UAT ones above, never a fallback between the two. |
| `ICICI_MERCHANT_ID` | UAT: `100000000007164` | |
| `ICICI_AGGREGATOR_ID` | UAT: `A100000000007164` | |
| `ICICI_HASH_KEY` | UAT hash key | **Secret. Never log, never commit, never expose.** |
| `ICICI_CURRENCY_CODE` | defaults to `356` | |
| `ICICI_PAY_TYPE` | defaults to `0` | |
| `ICICI_TRANSACTION_TYPE` | defaults to `SALE` | |
| `ICICI_UAT_INITIATE_SALE_URL` | defaults to `https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale` | single source of truth — no other name is read |
| `ICICI_UAT_COMMAND_URL` | defaults to `https://pgpayuat.icicibank.com/tsp/pg/api/command` | |
| `ICICI_UAT_SETTLEMENT_DETAILS_URL` | defaults to `https://pgpayuat.icicibank.com/tsp/pg/api/settlementDetails` | not used by any code path yet — see §13 |
| `ICICI_RETURN_URL` | Prezenti's own return endpoint, e.g. `https://prezenti.com/api/payments/icici/return` | required, no default |
| `SUPABASE_SECRET_KEY` | server-side DB access, bypasses RLS (current Supabase naming) | **Secret.** Primary; `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT-format key) is read as a fallback only. |
| `SUPABASE_URL` (or reuses `VITE_SUPABASE_URL`) | project URL (not secret) | **Project confirmed live** — see §6. |

## 4a. ICICI production — confirmed working, but only for the fixed demo amount

Production is **enabled and confirmed working end-to-end against the real bank**: `ICICI_ENV=production` and `ICICI_PRODUCTION_CONFIRM` are both set in the live Vercel Production environment, real `ICICI_PROD_*` credentials are provisioned, and a real Initiate Sale request was accepted by ICICI (`R1000`) with a customer successfully reaching ICICI's real hosted Direct Orange payment page. The payment itself was not completed (deliberately stopped at the hosted page, per instruction).

- `ICICI_ENV=production` alone is still **not sufficient** on its own — `getIciciConfig()` additionally requires `ICICI_PRODUCTION_CONFIRM` to equal the exact literal value in `ICICI_PRODUCTION_CONFIRMATION_VALUE` (`api/_lib/payments/icici/env.ts`). This remains a deliberate second gate; it is now satisfied in production by an explicit choice, not by accident.
- Credentials are read from `ICICI_PROD_MERCHANT_ID`/`ICICI_PROD_AGGREGATOR_ID`/`ICICI_PROD_HASH_KEY` — entirely separate variable names from the UAT ones, with no fallback in either direction.
- `httpClient.ts`'s host guard (`assertIciciHostMatchesEnvironment`) is environment-aware: a UAT config can only ever reach `pgpayuat.icicibank.com`; a production config can only ever reach `pgpay.icicibank.com` (the API call host). A call site that omits the environment parameter defaults to `'uat'` — the restrictive choice.
- **Redirect validation uses a separate, small allow-list** (`ICICI_PRODUCTION_REDIRECT_HOSTNAMES` in `env.ts`): `pgpay.icicibank.com` **and** `pgpay.icici.bank.in`. This was a real incident during rollout — ICICI's confirmed, real hosted-payment-page redirect target is `pgpay.icici.bank.in`, a *different* domain from the API call host it accepted the request on. The original single-hostname check rejected every genuine acceptance as an "unsafe redirect" until this was diagnosed via forensic logging against real production traffic and fixed (commit `3399d39`). Exact hostname matching only, in both directions — no wildcard/subdomain matching, UAT and production allow-lists never cross.

**Why this is still not ready for real customer traffic, despite the confirmed working redirect:**

1. **The ₹2.00 fixed UAT/demo test amount (§5) is still hardcoded and used unconditionally, regardless of environment.** The confirmed production transaction above used this same fixed ₹2.00 value — it did **not** exercise any real pricing logic, because none exists yet. Every real customer would currently be charged exactly ₹2.00 instead of what they actually owe. This must be replaced with a real server-resolved amount before this is used for actual customer payments.
2. **Only the Initiate Sale leg has been confirmed against the real bank.** The return/callback route, transaction correlation, and STATUS/reconciliation have all been unit-tested with real cryptography but never exercised against an actual ICICI callback or STATUS response — no customer has completed a real payment yet, so this hasn't happened naturally either.
3. UAT's own gateway was separately observed down (bank-side `502` infrastructure outage) during earlier development and was never completed end-to-end — this is a historical note, not a current blocker, since production is now the confirmed-working path.

## 3. Direct Orange PG Initiate Sale

**Endpoint:** `POST https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale`, `Content-Type: application/json`.

**Request fields** (`api/_lib/payments/icici/crypto.ts`, `IciciDirectOrangeInitiateSaleFields`): `merchantId, aggregatorID, merchantTxnNo, amount, currencyCode, payType, customerEmailID, transactionType, returnURL, txnDate, customerMobileNo, customerName, addlParam1, addlParam2, secureHash`.

### Hash — ICICI Hash Calculation V1 (source: official Gateway Interface Specification V0.4, read in full)

This integration's Initiate Sale, return/callback, and STATUS hashes all use the SAME documented, generic algorithm — **Hash Calculation V1** (`generateIciciHashV1`/`buildIciciHashV1Input` in `crypto.ts`), not distinct per-endpoint formulas:

1. Concatenate the VALUES of every non-null, non-empty parameter actually being sent/received (the `secureHash` field itself excluded) — **in ascending order of parameter NAME**, no delimiter, no field names. Per the doc's own Note 1, parameters not on a published field table still participate if actually present and non-empty (confirmed concretely: the STATUS command's worked sample includes `addlParam1`, which isn't in that command's published table).
2. HMAC-SHA256. **Key bytes: UTF-8. Message bytes: ASCII** — both confirmed from the bank's own Java reference (`keyString.getBytes("UTF-8")`, `msg.getBytes("ASCII")`). An earlier pass of this module used UTF-8 for the message too; that was a real discrepancy, now fixed.
3. Hex-encode, then lowercase.

For Direct Orange Initiate Sale specifically, this produces the alphabetical-by-field-name order: `addlParam1, addlParam2, aggregatorID, amount, currencyCode, customerEmailID, customerMobileNo, customerName, merchantId, merchantTxnNo, payType, returnURL, transactionType, txnDate` — verified byte-for-byte against a documented worked example (`crypto.test.ts`). Reproducing that example's actual bank-issued `secureHash` additionally requires the real UAT hash key, unavailable in this session, left as `it.skip`, not faked.

**Note on document naming**: an earlier pass of this integration referred to this scheme as "Hash Version 2" based on a paraphrase. The actual document calls it **Hash Calculation V1** (a distinct "V2" scheme also exists in the doc — JSON-request hashing via an HTTP header — used only by a few unrelated APIs like Get Card Bin/UserCancel/Get Service Charges, not by anything in this integration's scope). Corrected throughout.

### Request value formatting (all confirmed)
- `amount`: fixed two-decimal string, e.g. `"2.00"` — never reformatted between hash computation and transmission.
- `currencyCode = "356"`, `payType = "0"`, `transactionType = "SALE"`.
- `txnDate`: `yyyyMMddHHmmss`, generated server-side in **Asia/Kolkata (IST)** — the bank documentation confirms the format but not the timezone; IST was chosen deliberately (ICICI is an Indian bank) and documented here per the requirement to state the chosen timezone explicitly. This is a reconciliation-readability choice, not a security-relevant one.
- `merchantTxnNo`: generated server-side (`merchantTxnNo.ts`), ≤20 characters (bank-confirmed: longer values suppress QR code generation), collision-resistant (timestamp + random suffix), enforced by both a runtime check and a database `varchar(20)` + check constraint.
- `addlParam1`/`addlParam2`: currently sent as `""` when not supplied. **Unconfirmed** whether this is the bank's expected representation for an absent optional parameter — flagged in code, revisit if UAT testing shows otherwise.

## 4. Initiate Sale response handling

Validated fields (`initiateSaleResponse.ts`): `responseCode`, `merchantId`, `aggregatorID`, `merchantTxnNo` (all must match what was sent), and when `responseCode === "R1000"`, `redirectURI` and `tranCtx` must also be present.

**`R1000` means successful initiation only — never payment completion.** This is enforced structurally: the result type has no "payment success" field, only `initiationAccepted`, and the internal transaction status set on `R1000` is `INITIATED`, never `SUCCESS`.

Before any redirect URL is handed to the frontend, `redirect.ts` independently re-validates it: must be a well-formed absolute URL, must use HTTPS, and must exactly match one hostname on the allow-list for the caller's own ICICI environment — `pgpayuat.icicibank.com` for UAT; for production, `pgpay.icicibank.com` **or** `pgpay.icici.bank.in` (`ICICI_PRODUCTION_REDIRECT_HOSTNAMES` in `env.ts` — confirmed via this integration's own forensic diagnostic logging against real production traffic that ICICI's hosted-payment-page redirect target is a different domain from the API call host it accepted the request on) — never a hostname from the other environment, never anything else, and never by wildcard/subdomain match. This catches a corrupted/hijacked response even if the `responseCode`/field checks above somehow passed. If this check fails, the transaction is marked `UNKNOWN` and no redirect URL is ever returned to the browser.

## 5. Authoritative payment amount

Prezenti currently has **no order/quote/invoice pricing model with a stored amount** — `QuoteDraft`/`ExpertInquiryFormValues` (the only "quote" concept in the codebase) has no amount field, and the public Pricing page's numbers are explicitly documented as indicative starting prices, not fixed quotes. This is a pre-existing gap, not something introduced by this integration.

Per instruction, the browser is never allowed to supply or influence the amount. Until a real pricing/order model exists, `initiateSaleService.ts` uses a fixed constant, `ICICI_UAT_TEST_AMOUNT = "2.00"` (matching the ICICI documented sample), and the input type accepted from the frontend (`IciciInitiateSaleServiceInput`) has **no amount field at all** — a browser-supplied amount is structurally impossible to reach ICICI through this code path, not just filtered out by convention.

This must not be treated as a production amount model — confirmed by the fact that the live, confirmed-working production transaction (§4a) also used this same fixed ₹2.00 value, not real pricing. Before enabling any non-test customer payment, this constant must be replaced with a real server-resolved amount tied to an actual order/quote record. This is the single remaining hard blocker between "production redirect confirmed working" and "ready for real customer payments."

## 6. Database

**Confirmed live**, project ref `mbvxqywodlartkfwbgxd`, verified directly via Supabase MCP (`list_tables`/`execute_sql`), not assumed from any prior claim:

- `payment_transactions` table exists with the expected columns (see below).
- `record_payment_callback` SQL function exists.
- One `updated_at`-maintenance trigger exists on the table.
- 7 indexes exist (including the unique/partial-unique idempotency indexes on `merchant_txn_no`, `provider_transaction_id`, `provider_payment_id`).
- RLS is **enabled** with **zero policies** — empirically tested by switching to the `anon`/`authenticated` Postgres roles inside a transaction and confirming both `select` and `insert` are denied, then rolling back. Only a service-role/secret-key connection (server-side only) can read or write.
- A disposable live integration test (create → initiate-outcome update → callback → duplicate callback → public-status read → cleanup) was run directly against this project and passed; the row was deleted afterward. `select count(*) from payment_transactions` currently returns **0** — no leftover test rows.

`supabase/migrations/20260921040414_create_payment_transactions.sql` remains in-repo as a **reviewable reference copy** of the schema — per explicit project policy, it is never run as a migration by any tool (`supabase db push` etc. is not used). The live schema, including this turn's `record_payment_callback` extension (see below), was applied directly via Supabase MCP `execute_sql`, not via this file.

Table `payment_transactions`: `id`, `merchant_txn_no` (unique, ≤20 chars), `provider`, `provider_transaction_id`/`provider_payment_id` (unique where non-null — idempotency keys, now actually populated from `payload.txnID`/`payload.paymentID` on a verified callback), `tran_ctx`, `internal_reference`, `amount numeric(12,2)` + `currency`, `customer_name`/`customer_email`/`customer_mobile`, `return_url`, `addl_param1`/`addl_param2`, `status` (checked against the seven-value enum below), `payment_mode`, `payment_sub_inst_type`, `response_code`, `response_description`, `payment_datetime`, `raw_initiate_response`/`raw_callback_payload` (jsonb, audit trail — never contains the hash key/OTP/CVV/card data), `callback_received_count`, `last_callback_at`, `created_at`, `updated_at` (auto-maintained by trigger).

`record_payment_callback(p_merchant_txn_no, p_status, p_raw_callback_payload, p_provider_transaction_id, p_provider_payment_id, p_response_code, p_response_description, p_payment_mode, p_payment_datetime)` — extended to actually persist provider-assigned identifiers and response metadata, not just status (all six new parameters `default null`, existing values preserved via `coalesce` when a callback omits a field). A prior pass's `CREATE OR REPLACE FUNCTION` with a different parameter list had created a second, orphaned 3-argument overload (`record_payment_callback(text,text,jsonb)`) alongside this one, rather than replacing it in place. **Cleaned up**: confirmed via `pg_proc` that only the current 9-argument signature is called anywhere in application code, then dropped the obsolete overload directly via Supabase MCP SQL (`drop function public.record_payment_callback(text, text, jsonb);`) and re-verified only the intended signature remains.

No card number, CVV, OTP, or other payment-instrument data is stored anywhere in this schema.

**Migration policy for this project: direct SQL via Supabase MCP only.** Do not run `supabase db push`/`migration up`, and do not create additional migration files, unless this policy is explicitly changed.

## 7. Transaction lifecycle

```
INITIATED  — Initiate Sale accepted (R1000 + valid redirect); customer redirected to ICICI, has not paid yet
PENDING    — verified callback with responseCode R1000 (out-of-band, e.g. UPI); or STATUS txnStatus=REQ
SUCCESS    — verified callback with responseCode 000/0000; or STATUS txnStatus=SUC
FAILED     — Initiate Sale rejected; verified callback with any other responseCode; or STATUS txnStatus=REJ/ERR
CANCELLED  — reserved; no confirmed bank signal currently maps here (see correction below)
EXPIRED    — reserved; no confirmed bank signal currently maps here (see correction below)
UNKNOWN    — hash verification failed/missing, malformed payload, network/parse failure, or a validated-but-suspicious response (e.g. failed redirect-safety check); always the safe default when in doubt
```

**CORRECTION** (found by reading the actual official document in full — "Gateway_Interface_Specifiation_V0.4_Orange_PG", all 76 pages): an earlier pass of this integration's `responseCodes.ts` contained a granular code table (`0000`=successful, `0015`=expired, `0017`=customer cancel, `0392`=cancelled by user, `0395`=user aborted, `0396`=awaited, `0397`=aborted, `0399`=failed), attributed to "the supplied ICICI documentation." **None of these specific codes appear anywhere in the actual document.** Its real origin is unknown — it was never verified against a primary source. It is kept in `responseCodes.ts` as `ICICI_RESPONSE_CODES_UNCONFIRMED`, clearly marked, for reference only — **no trusted code path uses it.**

What the actual document DOES establish (Chapters 6/7, Payment Response/Authorize/Refund responseCode remarks): **`"000"`/`"0000"` = Success; `"R1000"` = Request Initiated successfully (out-of-band, e.g. UPI — the payment has NOT concluded); any other value = failure.** This is what `mapIciciPaymentResponseCode` (`responseCodes.ts`) actually implements and what `callback.ts` uses. Distinct CANCELLED/EXPIRED codes are not established by this document for the Payment Response — if the bank confirms specific codes for those states, add them explicitly rather than guessing.

The Transaction STATUS command (Chapter 12) uses a separate, confirmed enum for `txnStatus`: `REQ` (received/in process) → PENDING, `SUC` (successful) → SUCCESS, `REJ` (rejected) → FAILED, `ERR` (error) → FAILED (`mapIciciTxnStatusToInternalStatus`).

## 8. Return / callback — fully implemented and cryptographically verified

**Both previously-open items are now confirmed** (official doc, read in full):

1. **Transport**: browser POST, `application/x-www-form-urlencoded`, to the merchant return URL, after redirect-based authorization. "Only POST parameters are considered for secureHash calculation. Query parameters are not considered for secureHash calculation." `api/payments/icici/return.ts` now only accepts `POST` (rejects `GET`/others with 405) and hashes/verifies exclusively `request.body` — query-string values are never read for this route at all.
2. **secureHash formula**: ICICI Hash Calculation V1 (§3) over the entire received POST body (every non-empty field, `secureHash` excluded) — the same generic algorithm as Initiate Sale, applied to the response's own field set. `verifyIciciReturnSecureHash` (`callback.ts`) is a real, constant-time-compared check, proven against an independently-computed reference hash (not circular against this module's own logic) in `callback.test.ts`.

`api/_lib/payments/icici/callback.ts` defines `IciciReturnPayload` matching the doc's actual field names (corrected: `secureHash` with capital H, not `securehash` — confirmed from the doc's own worked form sample) — `responseCode, respDescription, merchantId, aggregatorID, merchantTxnNo, txnID, paymentDateTime, paymentID, paymentMode, paymentSubInstType, amount, customerMobileNo, customerEmailID, addlParam1, addlParam2, secureHash`. Hash verification itself operates on the *entire raw POST body*, not this typed subset, per the doc's Note 1 (unpublished-but-present fields still participate).

`processIciciReturn` now reaches real terminal states: `VERIFIED` + `SUCCESS`/`PENDING`/`FAILED` when the hash checks out and `mapIciciPaymentResponseCode` resolves the code; `REJECTED_HASH_MISMATCH` (status `UNKNOWN`) when it doesn't; `REJECTED_INVALID_SHAPE` (status `UNKNOWN`) for a malformed payload. A payload can never reach `SUCCESS` on responseCode alone — verified by test (`callback.test.ts`: a payload with a hash computed under the wrong key, or with any tampered field, never yields `SUCCESS`).

**Transaction correlation (added this turn, closes a real gap)**: a cryptographically valid `secureHash` proves the message came from the shared-key holder — it does **not** by itself prove the callback is about the right transaction or the right amount. `correlateWithLocalTransaction` (`callback.ts`) additionally checks a hash-verified callback against the locally-initiated transaction record (fetched via `repository.getPublicStatusByMerchantTxnNo`) before trusting it: rejects (downgrades to `UNKNOWN`) if no local transaction exists, if `merchantId`/`aggregatorID` don't match this integration's own config, or if the callback's `amount` doesn't match the locally-stored amount (small floating-point tolerance only); and **never downgrades** a transaction that is already locally `SUCCESS`, protecting against a stale/duplicate callback overwriting a settled result. `return.ts` calls this after hash verification and before persisting, and logs (never throws) when a downgrade occurs. Fully unit-tested, including the never-downgrade-SUCCESS case.

The route also: records receipt idempotently via the `record_payment_callback` SQL function (always an `UPDATE`, never an `INSERT` — tested), now also persisting `providerTransactionId`/`providerPaymentId` (from `payload.txnID`/`payload.paymentID`) and response metadata (`responseCode`, `responseDescription`, `paymentMode`, `paymentDatetime` — parsed from the bank's `yyyyMMddHHmmss` format to ISO+05:30 via `parseIciciDateTime`); redirects to a **fixed internal path** (`/payment/result?merchantTxnNo=...`) only, never a bank-/browser-supplied target (tested); stays reachable even when `ICICI_HASH_KEY` is unset (verification then simply always fails, staying `UNKNOWN` — tested).

**Not yet exercised end-to-end**: no real ICICI callback has ever been received (no UAT payment has been completed). The callback route, correlation logic, and idempotent recording have all been exercised against the live, confirmed Supabase project (§6) with real database round-trips — not yet against an actual bank response.

## 9. STATUS / reconciliation — hash confirmed, full HTTP integration and public route implemented, no live call made

**Confirmed and implemented** (doc Chapter 12 + its worked curl sample):
- Endpoint: `https://pgpayuat.icicibank.com/tsp/pg/api/command` (UAT).
- Transport: server-to-server POST, `application/x-www-form-urlencoded` — `postIciciCommand` (`httpClient.ts`) sends the request body via `URLSearchParams`, same UAT-host guard and timeout/abort behavior as Initiate Sale.
- Request fields: `merchantID, aggregatorID` (conditional), `merchantTxnNo, originalTxnNo, transactionType=STATUS`, `oth_charge` (conditional), plus `addlParam1` — present in the doc's own worked sample despite not being on the published field table, which is itself confirming evidence for the doc's general "unpublished fields still participate in the hash" rule.
- Hash: the **same** ICICI Hash Calculation V1 primitive (§3) — not a distinct STATUS-specific formula. `generateIciciStatusHash`/`buildIciciStatusRequestBody` (`statusCheck.ts`) build the full signed, form-ready request body.
- Response fields (Chapter 12.2 + worked JSON sample): `responseCode, respDescription, merchantId, aggregatorID, merchantTxnNo, txnStatus (REQ/SUC/REJ/ERR), txnResponseCode, txnRespDescription, txnID, paymentDateTime, txnAuthID, secureHash`, plus additional fields seen in the sample but not the table (`amount, authCode, paymentMode, customerEmailID, TransmissionDateTime, oth_charge, paymentInstId, customerMobileNo`). `verifyIciciStatusResponseHash` verifies these the same way as the callback response, and a response is only ever mapped to a non-`UNKNOWN` status when this verification passes.

`checkIciciTransactionStatus` (`statusCheck.ts`) is the full orchestration: builds the request, calls `postIciciCommand`, and returns one of five explicit outcomes — `VERIFIED` (hash-checked, status mapped via `mapIciciTxnStatusToInternalStatus`), `REJECTED_HASH_MISMATCH`, `REJECTED_MALFORMED_RESPONSE`, `REJECTED_HTTP_ERROR`, or `TIMEOUT` (a timeout is never silently retried — the caller is expected to leave the transaction PENDING/UNKNOWN and reconcile later). Comprehensively unit-tested (`statusCheck.test.ts`), including a hash-mismatch case that must never resolve to `SUCCESS`.

**Now wired to a public route**: `POST /api/payments/icici/reconcile` (`api/payments/icici/reconcile.ts`) accepts only a `merchantTxnNo` (validated against the same safe alphabet used elsewhere — no other client input is read), resolves the local transaction, and:
- returns immediately without calling ICICI if the local transaction is already `SUCCESS` (never re-queried, never at risk of a downgrade — same principle as the callback correlation in §8);
- returns 404 for an unknown `merchantTxnNo` before any bank call is made;
- otherwise calls `checkIciciTransactionStatus`, and only on outcome `VERIFIED` — and only when the verified response's own `merchantTxnNo` (when present) matches the request — persists the reconciled status via `recordCallback` (the same idempotent, UPDATE-only path used by the return/callback route) and re-reads the row to return the refreshed, authoritative state;
- on any non-`VERIFIED` outcome (hash mismatch, timeout, malformed response, HTTP error) or a `merchantTxnNo` mismatch, leaves the local row untouched and simply returns the last known status, never a fabricated one;
- never returns the hash key, the raw ICICI response body, or any internal id — only the same safe public fields `GET /api/payments/icici/status` already returns, plus a `reconciled: boolean` flag.

Route-level tests (`reconcile.test.ts`) cover: method/origin enforcement, malformed/missing `merchantTxnNo` rejected before any DB or bank call, unknown transaction → 404, already-`SUCCESS` transaction never re-queried, a verified `SUC`/`REJ` response persisted and reflected in the response, a hash-mismatched or timed-out response never persisted, a `merchantTxnNo` mismatch between request and verified response never persisted, and no secret ever appears in the response body. No STATUS request has ever been sent to the actual bank.

## 10. Idempotency

- `payment_transactions.merchant_txn_no` — unique, enforced at the database level (Prezenti generates this, so this alone prevents Prezenti from ever double-initiating the same transaction).
- `provider_transaction_id` / `provider_payment_id` — unique partial indexes (unique only where non-null, since they're unknown until ICICI assigns them) — this is the actual guard against a repeated callback creating a second payment record.
- The callback route's `recordCallback` always performs an `UPDATE` (via the `record_payment_callback` SQL function) against the row matching `merchantTxnNo`, never an `INSERT` — tested explicitly that two identical callbacks never create two rows.
- `callback_received_count` / `last_callback_at` exist for diagnostics but correctness does not depend on them (per instruction) — the unique constraints and update-only design above are the real guarantee.
- Unit-tested (route + repository level, mocked DB client) **and** exercised against the live, confirmed Supabase project (§6): a disposable integration test sent a duplicate callback for the same `merchantTxnNo` and confirmed no second row was created.

## 11. Payment Advice — not implemented, conclusion documented

The supplied material describes Payment Advice as a general platform capability (server-to-server POST for successful payments) but does not establish that Direct Orange PG requires it in addition to the payment return, specifically for Prezenti's integration. Per instruction, this is **not assumed to be mandatory**. No Payment Advice endpoint has been built. If the bank later confirms it is required for Direct Orange PG, it must converge on the same `payment_transactions` ledger and idempotency path described above — never create a second/parallel payment record.

## 12. Refund — out of scope, architecture-compatible only

Not implemented, per instruction (no customer-facing refund UI, no automatic refunds). The Command endpoint client, when eventually built for STATUS, would be structurally reusable for refund requests, but nothing refund-specific exists yet.

## 13. Settlement — out of scope, separate reconciliation capability

Settlement Details/Advice exists in the supplied material but is unrelated to completing a customer's checkout — it's a back-office reconciliation concern. `ICICI_UAT_SETTLEMENT_DETAILS_URL` is configured (defaulted) but not called by any code path. Not required to unblock checkout completion.

## 14. Known limitations / blockers (current, verified — not hypothetical)

1. **No real pricing/order model — the hard blocker before real customer payments.** The fixed ₹2.00 test amount (§5) is still used unconditionally; the confirmed-working production transaction (§4a) used this same fixed value, not real pricing.
2. **Return/callback and STATUS have not been exercised against a real bank response** — only Initiate Sale has (§4a). No real customer has completed a payment yet, so the callback route has never received a genuine ICICI POST.
3. **`addlParam1`/`addlParam2` empty-value representation unconfirmed** (§3) — the doc doesn't state what an absent optional parameter should look like on the wire (omitted vs. empty string). Did not block the confirmed production acceptance, but remains unconfirmed against the doc itself.
4. **No rate limiting on `reconcile` or `status`** (§9) — both public routes trust origin-checking and `merchantTxnNo`'s own entropy (timestamp + random suffix) as the only enumeration mitigations; no dedicated rate limiter exists in this codebase. Revisit before real customer traffic.
5. UAT's own gateway was separately observed down (bank-side infrastructure `502`) during earlier development and was never completed end-to-end — historical note only; production is now the confirmed-working path (§4a).
6. The database, callback route, reconciliation route, and idempotency logic have all been exercised against the live, confirmed Supabase project (§6, §10) with real round-trips and cleanup — but only with synthetic/local data, not yet a real ICICI callback (see #2 above).

## 15. Security summary

- Hash key and Supabase secret key: server-side only, never logged (asserted by tests), never returned in any API response, never in `VITE_*`.
- Browser cannot influence amount, status, merchantTxnNo, transactionType, merchantId, aggregatorID, secureHash, currency, or returnURL — all server-resolved.
- CSP (`vercel.json`) was reviewed: the redirect to ICICI is a plain top-level `window.location` navigation, not a form submission or iframe, so `form-action 'self'` does not apply and was **not weakened**. `connect-src` also needed no change since the ICICI call happens server-side, not from the browser. No CSP changes were made.
- Vercel routing: `/api/(.*)` is rewritten before the SPA catch-all in `vercel.json`, so the new API routes are not intercepted by `index.shell.html`.
