/**
 * ICICI Orange PG return/callback (Payment Response) processing.
 *
 * SOURCE: rewritten against the actual official ICICI document
 * ("Gateway_Interface_Specifiation_V0.4_Orange_PG"), read in full. This
 * resolves what was previously a deliberate, fail-closed gap:
 *
 * - **Transport**: confirmed (Chapter 1 / Chapter 7 / page 27) — after
 *   redirect-based authorization, the payment response is POSTed by the
 *   browser to the merchant's return URL as `application/x-www-form-
 *   urlencoded`. "Only POST parameters are considered for secureHash
 *   calculation. Query parameters are not considered for secureHash
 *   calculation." This module and its caller (the HTTP route) must never
 *   use query-string values for verification.
 * - **secureHash formula**: confirmed — ICICI Hash Calculation V1 (see
 *   crypto.ts): concatenate the VALUES of every non-null, non-empty POST
 *   parameter actually received (the `secureHash` field itself excluded)
 *   in ascending order of parameter NAME, HMAC-SHA256 (key UTF-8,
 *   message ASCII), hex, lowercase. Per the doc's Note 1, this includes
 *   parameters not on the published field table — so verification here
 *   operates on the *entire* received payload, not a fixed known subset.
 * - **Field name**: the doc's own worked form sample (page 27) uses
 *   `secureHash` (capital H) as the actual wire field name — an earlier
 *   pass of this module used `securehash` (all lowercase), which was
 *   never confirmed and is now corrected.
 *
 * `verifyIciciReturnSecureHash` is therefore now a REAL cryptographic
 * check (constant-time comparison), and `processIciciReturn` can reach a
 * trusted SUCCESS/PENDING/FAILED status — but only when that check
 * passes. Any payload that fails verification (or was never a genuine
 * POST body, e.g. query-string-only) is UNKNOWN/rejected, never trusted.
 */

import { verifyIciciHashV1 } from './crypto.js';
import { mapIciciPaymentResponseCode, type IciciInternalTransactionStatus } from './responseCodes.js';

/**
 * The documented Payment Response fields (Chapter 7.1 table + the
 * worked form sample). This module never restricts hash verification to
 * only these — see module doc re: Note 1 — but this typed view covers
 * the fields Prezenti's business logic actually reads.
 */
export interface IciciReturnPayload {
  responseCode?: string;
  respDescription?: string;
  merchantId?: string;
  aggregatorID?: string;
  merchantTxnNo?: string;
  txnID?: string;
  paymentDateTime?: string;
  paymentID?: string;
  paymentMode?: string;
  paymentSubInstType?: string;
  amount?: string;
  customerMobileNo?: string;
  customerEmailID?: string;
  addlParam1?: string;
  addlParam2?: string;
  secureHash?: string;
}

/**
 * Verifies the secureHash on a return/callback payload using ICICI Hash
 * Calculation V1 over the ENTIRE raw payload (every non-empty field
 * actually present, `secureHash` itself excluded) — not just the fields
 * `IciciReturnPayload` happens to type, per the doc's Note 1. `rawPayload`
 * must be the exact POST body fields only — never query-string values
 * (doc-confirmed: query params are excluded from the hash). Thin wrapper
 * over the shared `verifyIciciHashV1` primitive (crypto.ts) — kept under
 * this name for call-site clarity in the callback/return code path.
 */
export function verifyIciciReturnSecureHash(rawPayload: Record<string, string>, hashKey: string): boolean {
  return verifyIciciHashV1(rawPayload, hashKey);
}

export interface IciciReturnValidationError {
  field: keyof IciciReturnPayload;
  reason: string;
}

/** Checks that a return payload has the minimum fields needed to even attempt processing (before hash verification). Pure, no I/O. */
export function validateIciciReturnPayloadShape(payload: IciciReturnPayload): IciciReturnValidationError[] {
  const errors: IciciReturnValidationError[] = [];
  const requiredFields: Array<keyof IciciReturnPayload> = ['merchantTxnNo', 'responseCode', 'secureHash'];

  for (const field of requiredFields) {
    if (!payload[field]) {
      errors.push({ field, reason: 'missing or empty' });
    }
  }

  return errors;
}

export interface IciciReturnProcessingResult {
  outcome: 'REJECTED_INVALID_SHAPE' | 'REJECTED_HASH_MISMATCH' | 'VERIFIED';
  status: IciciInternalTransactionStatus;
  merchantTxnNo?: string;
  responseCode?: string;
  responseDescription?: string;
  validationErrors?: IciciReturnValidationError[];
}

/**
 * Orchestrates return/callback processing: shape validation -> secureHash
 * verification (over the raw POST body only) -> responseCode mapping.
 * Only ever reaches a non-UNKNOWN terminal status when verification
 * actually passes. Does NOT persist anything or call any database —
 * that belongs in the HTTP route handler.
 *
 * `rawPostBody` must be exactly the POST body fields (never merged with
 * query-string values) — this is the parameter this function hashes.
 */
export function processIciciReturn(
  payload: IciciReturnPayload,
  rawPostBody: Record<string, string>,
  hashKey: string,
): IciciReturnProcessingResult {
  const validationErrors = validateIciciReturnPayloadShape(payload);
  if (validationErrors.length > 0) {
    return { outcome: 'REJECTED_INVALID_SHAPE', status: 'UNKNOWN', validationErrors };
  }

  const responseCode = payload.responseCode as string;
  const merchantTxnNo = payload.merchantTxnNo as string;

  if (!verifyIciciReturnSecureHash(rawPostBody, hashKey)) {
    return {
      outcome: 'REJECTED_HASH_MISMATCH',
      status: 'UNKNOWN',
      merchantTxnNo,
      responseCode,
      responseDescription: payload.respDescription,
    };
  }

  return {
    outcome: 'VERIFIED',
    status: mapIciciPaymentResponseCode(responseCode),
    merchantTxnNo,
    responseCode,
    responseDescription: payload.respDescription,
  };
}

/** The locally-stored transaction fields needed to correlate an incoming, hash-verified callback against what Prezenti actually initiated. */
export interface LocalTransactionSnapshot {
  amount: string;
  status: IciciInternalTransactionStatus;
}

export interface IciciCorrelationConfig {
  merchantId: string;
  aggregatorId?: string;
}

/**
 * Cross-checks a hash-VERIFIED callback against the transaction Prezenti
 * actually has on record, before that status is ever treated as final.
 * A cryptographically valid secureHash proves the message came from
 * someone holding the shared key — it does not by itself prove the
 * message is about the transaction we think it is, or for the amount we
 * actually initiated, so this is defense-in-depth, not the primary
 * security boundary (that's the hash itself).
 *
 * Returns UNKNOWN (never the bank-reported status) when:
 * - no local transaction exists for this merchantTxnNo at all;
 * - the payload's merchantId/aggregatorID (when present) don't match our
 *   own configured values;
 * - the payload's amount (when present) doesn't match the amount
 *   Prezenti recorded when it initiated the transaction.
 *
 * Returns SUCCESS unconditionally — never a downgrade — when the local
 * transaction is already SUCCESS, so a stale/replayed non-success
 * callback can never overwrite a transaction Prezenti has already
 * confirmed as paid.
 */
export function correlateWithLocalTransaction(
  payload: IciciReturnPayload,
  verifiedStatus: IciciInternalTransactionStatus,
  local: LocalTransactionSnapshot | null,
  config: IciciCorrelationConfig,
): IciciInternalTransactionStatus {
  if (!local) return 'UNKNOWN';
  if (local.status === 'SUCCESS') return 'SUCCESS';

  if (payload.merchantId && payload.merchantId !== config.merchantId) return 'UNKNOWN';
  if (payload.aggregatorID && config.aggregatorId && payload.aggregatorID !== config.aggregatorId) return 'UNKNOWN';

  if (payload.amount) {
    const paidAmount = Number(payload.amount);
    const expectedAmount = Number(local.amount);
    const amountsAreComparable = Number.isFinite(paidAmount) && Number.isFinite(expectedAmount);
    const amountsMatch = amountsAreComparable && Math.abs(paidAmount - expectedAmount) < 0.005;
    if (!amountsMatch) return 'UNKNOWN';
  }

  return verifiedStatus;
}
