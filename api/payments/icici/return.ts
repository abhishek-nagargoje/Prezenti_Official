/**
 * ICICI Orange PG return/callback endpoint (Payment Response).
 *
 * TRANSPORT CONFIRMED (official Gateway Interface Specification V0.4,
 * read in full): after redirect-based authorization, the payment
 * response is POSTed by the browser to the merchant's return URL as
 * `application/x-www-form-urlencoded`. "Only POST parameters are
 * considered for secureHash calculation. Query parameters are not
 * considered for secureHash calculation." Accordingly this route:
 * - only accepts POST (a GET here cannot be a genuine ICICI response —
 *   there is no documented GET-based return mechanism);
 * - hashes/verifies ONLY `request.body` fields, never `request.query`;
 * - passes the ENTIRE received body (every field, published or not — the
 *   doc's Note 1 requires this) into hash verification, not a filtered
 *   known subset.
 *
 * secureHash verification is REAL (see callback.ts) — no longer a
 * fail-closed stub. A payload only reaches a trusted status (SUCCESS/
 * PENDING/FAILED) after its secureHash is cryptographically verified;
 * anything else (bad shape, hash mismatch, wrong key) stays UNKNOWN.
 *
 * This endpoint records receipt idempotently (always an UPDATE against
 * the existing row, keyed by merchantTxnNo, never an INSERT) and
 * redirects the customer to a FIXED internal result-page path — never a
 * bank- or browser-supplied redirect target, so this cannot become an
 * open redirect.
 */

import {
  correlateWithLocalTransaction,
  processIciciReturn,
  validateIciciReturnPayloadShape,
  type IciciReturnPayload,
} from '../../_lib/payments/icici/callback';
import { getIciciConfig, IciciConfigError } from '../../_lib/payments/icici/env';
import { parseIciciDateTime } from '../../_lib/payments/icici/txnDate';
import {
  createSupabaseClientFromEnv,
  createSupabasePaymentTransactionRepository,
} from '../../_lib/payments/icici/repository';

interface ApiRequest {
  method?: string;
  headers: { [key: string]: string | string[] | undefined };
  body?: unknown;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(statusCode: number): ApiResponse;
  json(body: unknown): void;
  end(): void;
}

const RESULT_PAGE_PATH = '/payment/result';
const MERCHANT_TXN_NO_PATTERN = /^[A-Z0-9]{1,20}$/;

/** Normalizes a parsed POST body (form-urlencoded or JSON, however Vercel delivered it) into a flat string map. Arrays take their first value. */
function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      result[key] = raw;
    } else if (Array.isArray(raw) && typeof raw[0] === 'string') {
      result[key] = raw[0];
    }
  }
  return result;
}

/** Maps the raw POST body onto the documented Payment Response field names (see callback.ts's IciciReturnPayload). */
function toReturnPayload(rawBody: Record<string, string>): IciciReturnPayload {
  return {
    responseCode: rawBody.responseCode,
    respDescription: rawBody.respDescription,
    merchantId: rawBody.merchantId,
    aggregatorID: rawBody.aggregatorID,
    merchantTxnNo: rawBody.merchantTxnNo,
    txnID: rawBody.txnID,
    paymentDateTime: rawBody.paymentDateTime,
    paymentID: rawBody.paymentID,
    paymentMode: rawBody.paymentMode,
    paymentSubInstType: rawBody.paymentSubInstType,
    amount: rawBody.amount,
    customerMobileNo: rawBody.customerMobileNo,
    customerEmailID: rawBody.customerEmailID,
    addlParam1: rawBody.addlParam1,
    addlParam2: rawBody.addlParam2,
    secureHash: rawBody.secureHash,
  };
}

function buildResultRedirect(merchantTxnNo: string | undefined): string {
  if (merchantTxnNo && MERCHANT_TXN_NO_PATTERN.test(merchantTxnNo)) {
    return `${RESULT_PAGE_PATH}?merchantTxnNo=${encodeURIComponent(merchantTxnNo)}`;
  }
  // No usable reference — send the customer to the result page anyway;
  // it has its own "no reference" state. Never redirect anywhere
  // bank-/browser-supplied.
  return RESULT_PAGE_PATH;
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  // POST only — the documented ICICI return mechanism is exclusively a
  // browser POST of form-urlencoded data. A GET cannot be a genuine
  // response and is never treated as hash-eligible.
  if (request.method !== 'POST') {
    return response.status(405).json({ success: false, message: 'Method not allowed.' });
  }

  // Query-string values are NEVER used here (doc-confirmed: excluded
  // from secureHash calculation) — only the parsed POST body.
  const rawBody = asStringRecord(request.body);
  const payload = toReturnPayload(rawBody);

  const shapeErrors = validateIciciReturnPayloadShape(payload);
  if (shapeErrors.length > 0) {
    console.warn('[ICICI RETURN] malformed payload', {
      merchantTxnNo: payload.merchantTxnNo,
      missingFields: shapeErrors.map((e) => e.field),
    });
    response.setHeader('Location', buildResultRedirect(payload.merchantTxnNo));
    return response.status(302).end();
  }

  // Config may legitimately be incomplete right now (e.g. ICICI_HASH_KEY
  // not yet set) — that must not make this endpoint unreachable. Hash
  // verification will simply fail (never match) with an empty/wrong key,
  // so this fallback changes nothing about trust; it only keeps the
  // endpoint from 500ing on a config gap.
  let hashKey = '';
  let configMerchantId = '';
  let configAggregatorId: string | undefined;
  try {
    const config = getIciciConfig();
    hashKey = config.hashKey;
    configMerchantId = config.merchantId;
    configAggregatorId = config.aggregatorId;
  } catch (error) {
    if (error instanceof IciciConfigError) {
      console.warn('[ICICI RETURN] config incomplete, proceeding (hash verification will fail closed):', error.message);
    } else {
      throw error;
    }
  }

  const result = processIciciReturn(payload, rawBody, hashKey);

  console.info('[ICICI RETURN]', {
    merchantTxnNo: result.merchantTxnNo,
    outcome: result.outcome,
    status: result.status,
    responseCode: result.responseCode,
  });

  let finalStatus = result.status;

  try {
    const client = createSupabaseClientFromEnv();
    const repository = createSupabasePaymentTransactionRepository(client);

    if (result.merchantTxnNo) {
      // Only a hash-VERIFIED payload is even eligible for correlation —
      // an unverified one is already UNKNOWN and stays that way.
      if (result.outcome === 'VERIFIED') {
        const local = await repository.getPublicStatusByMerchantTxnNo(result.merchantTxnNo);
        finalStatus = correlateWithLocalTransaction(payload, result.status, local, {
          merchantId: configMerchantId,
          aggregatorId: configAggregatorId,
        });

        if (finalStatus !== result.status) {
          console.warn('[ICICI RETURN] correlation downgraded status', {
            merchantTxnNo: result.merchantTxnNo,
            verifiedStatus: result.status,
            correlatedStatus: finalStatus,
          });
        }
      }

      await repository.recordCallback({
        merchantTxnNo: result.merchantTxnNo,
        status: finalStatus,
        rawCallbackPayload: payload,
        providerTransactionId: payload.txnID,
        providerPaymentId: payload.paymentID,
        responseCode: result.responseCode,
        responseDescription: result.responseDescription,
        paymentMode: payload.paymentMode,
        paymentDatetime: parseIciciDateTime(payload.paymentDateTime),
      });
    }
  } catch (error) {
    // Never expose this to the customer, and never let a persistence
    // failure block the redirect — the customer must still land on a
    // page that can (once the underlying issue is fixed) reflect the
    // correct state. Do not fabricate success here regardless.
    console.error('[ICICI RETURN] failed to persist callback:', error instanceof Error ? error.message : error);
  }

  response.setHeader('Location', buildResultRedirect(result.merchantTxnNo));
  return response.status(302).end();
}
