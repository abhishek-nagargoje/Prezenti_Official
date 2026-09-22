/**
 * POST /api/payments/icici/reconcile
 *
 * Public server-side STATUS reconciliation endpoint. Resolves the local
 * transaction for a given `merchantTxnNo`, calls ICICI's Command STATUS
 * API (`checkIciciTransactionStatus`, `_lib/payments/icici/statusCheck.ts`)
 * to obtain the bank's authoritative view, and updates the local record
 * ONLY when that response's own secureHash verifies — never on the
 * client's say-so.
 *
 * Client input is trusted for nothing except *which* transaction to
 * reconcile (`merchantTxnNo`, validated against a strict safe alphabet).
 * The client can never supply an amount, a status, or any other field
 * that influences the result.
 *
 * A transaction already locally `SUCCESS` is never re-queried or
 * downgraded — same "never downgrade a settled transaction" principle as
 * the return/callback correlation logic (`callback.ts`).
 *
 * Response is always the same safe public shape used by
 * `GET /api/payments/icici/status` — never the hash key, never the raw
 * ICICI response body, never any internal id.
 */

import { getIciciConfig, IciciConfigError } from '../../_lib/payments/icici/env.js';
import { checkIciciTransactionStatus } from '../../_lib/payments/icici/statusCheck.js';
import {
  createSupabaseClientFromEnv,
  createSupabasePaymentTransactionRepository,
  type PublicPaymentTransactionStatus,
} from '../../_lib/payments/icici/repository.js';

interface ApiRequest {
  method?: string;
  headers: { origin?: string; [key: string]: string | string[] | undefined };
  body?: unknown;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(statusCode: number): ApiResponse;
  json(body: unknown): void;
  end(): void;
}

function resolveAllowedOrigin(): string | undefined {
  return process.env.INQUIRY_ALLOWED_ORIGIN || undefined;
}

function enforceOrigin(request: ApiRequest, response: ApiResponse): boolean {
  const allowedOrigin = resolveAllowedOrigin();
  const requestOrigin = request.headers.origin;

  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  response.setHeader('Vary', 'Origin');

  if (!allowedOrigin || !requestOrigin) return true;
  if (requestOrigin === allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', requestOrigin);
    return true;
  }
  return false;
}

/** merchantTxnNo is generated server-side with a known safe alphabet — reject anything else before it ever reaches a query or the bank. */
const MERCHANT_TXN_NO_PATTERN = /^[A-Z0-9]{1,20}$/;

function extractMerchantTxnNo(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).merchantTxnNo;
  if (typeof value !== 'string' || !MERCHANT_TXN_NO_PATTERN.test(value)) return null;
  return value;
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const originOk = enforceOrigin(request, response);

  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') {
    return response.status(405).json({ success: false, message: 'Method not allowed.' });
  }
  if (!originOk) {
    return response.status(403).json({ success: false, message: 'Request origin is not allowed.' });
  }

  const merchantTxnNo = extractMerchantTxnNo(request.body);
  if (!merchantTxnNo) {
    return response.status(400).json({ success: false, message: 'A valid merchantTxnNo is required.' });
  }

  let config;
  try {
    config = getIciciConfig();
  } catch (error) {
    if (error instanceof IciciConfigError) {
      console.error('[ICICI RECONCILE CONFIG ERROR]', error.message);
    } else {
      console.error('[ICICI RECONCILE CONFIG ERROR] unexpected', error);
    }
    return response.status(503).json({ success: false, message: 'Payment gateway is not available right now.' });
  }

  let repository;
  try {
    const client = createSupabaseClientFromEnv();
    repository = createSupabasePaymentTransactionRepository(client);
  } catch (error) {
    console.error('[ICICI RECONCILE REPOSITORY CONFIG ERROR]', error instanceof Error ? error.message : error);
    return response.status(503).json({ success: false, message: 'Payment gateway is not available right now.' });
  }

  let local: PublicPaymentTransactionStatus | null;
  try {
    local = await repository.getPublicStatusByMerchantTxnNo(merchantTxnNo);
  } catch (error) {
    console.error('[ICICI RECONCILE LOOKUP ERROR]', error instanceof Error ? error.message : error);
    return response.status(503).json({ success: false, message: 'Unable to retrieve payment status right now.' });
  }

  // Same response for "not found" regardless of why, and the lookup
  // above is the only DB round-trip on this path — no enumeration signal
  // beyond what the existing read-only GET status endpoint already
  // exposes for the same merchantTxnNo.
  if (!local) {
    return response.status(404).json({ success: false, message: 'Transaction not found.' });
  }

  // A transaction Prezenti has already confirmed as paid is never
  // re-queried or put at risk of a stale/conflicting bank response —
  // same "never downgrade SUCCESS" principle as the callback path.
  if (local.status === 'SUCCESS') {
    return response.status(200).json({ success: true, transaction: local, reconciled: false });
  }

  // `originalTxnNo` here is Prezenti's own merchantTxnNo of the Initiate
  // Sale being reconciled (see statusCheck.ts's IciciStatusCheckRequestFields
  // doc) — Prezenti does not track a separate bank-assigned "original"
  // transaction number distinct from what it generated.
  const checkResult = await checkIciciTransactionStatus(merchantTxnNo, merchantTxnNo, config);

  console.info('[ICICI RECONCILE]', {
    merchantTxnNo,
    outcome: checkResult.outcome,
    status: checkResult.status,
  });

  if (checkResult.outcome !== 'VERIFIED') {
    // Hash mismatch, malformed response, HTTP error, or timeout — never
    // trust an unverified result. Local state is left untouched and the
    // customer/ops caller simply sees the last known (still-authoritative)
    // status, not a fabricated one.
    return response.status(200).json({ success: true, transaction: local, reconciled: false });
  }

  // Correlate: a verified STATUS response's own merchantTxnNo (when
  // present) must match what was actually requested. A mismatch here
  // would mean the bank's response is not about the transaction Prezenti
  // asked about — never trust it in that case.
  if (checkResult.merchantTxnNo && checkResult.merchantTxnNo !== merchantTxnNo) {
    console.warn('[ICICI RECONCILE] merchantTxnNo mismatch between request and verified response', {
      requested: merchantTxnNo,
      returned: checkResult.merchantTxnNo,
    });
    return response.status(200).json({ success: true, transaction: local, reconciled: false });
  }

  try {
    await repository.recordCallback({
      merchantTxnNo,
      status: checkResult.status,
      rawCallbackPayload: {
        source: 'status-reconcile',
        txnResponseCode: checkResult.txnResponseCode ?? null,
        txnID: checkResult.txnID ?? null,
      },
      providerTransactionId: checkResult.txnID,
      responseCode: checkResult.txnResponseCode,
    });
  } catch (error) {
    console.error('[ICICI RECONCILE] failed to persist reconciled status:', error instanceof Error ? error.message : error);
    return response.status(200).json({ success: true, transaction: local, reconciled: false });
  }

  let refreshed: PublicPaymentTransactionStatus | null;
  try {
    refreshed = await repository.getPublicStatusByMerchantTxnNo(merchantTxnNo);
  } catch (error) {
    console.error('[ICICI RECONCILE] failed to re-read status after persisting:', error instanceof Error ? error.message : error);
    return response.status(200).json({ success: true, transaction: local, reconciled: false });
  }

  return response.status(200).json({ success: true, transaction: refreshed ?? local, reconciled: true });
}
