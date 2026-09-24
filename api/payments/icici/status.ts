/**
 * GET /api/payments/icici/status?merchantTxnNo=...
 *
 * Read-only lookup the frontend result page uses to obtain the
 * server-authoritative transaction status. The browser's own query
 * parameters (e.g. any `?status=success` ICICI might redirect with) are
 * NEVER trusted for this — only this endpoint's response is.
 *
 * Returns only safe, public fields (see PublicPaymentTransactionStatus in
 * repository.ts) — never the internal id, hash key, service-role key, or
 * raw gateway payload.
 *
 * This is a read-only lookup of the locally-stored, callback-updated
 * status only — it never calls ICICI itself. It does not perform (or
 * trigger) a bank-side STATUS/reconciliation check; that is
 * `checkIciciTransactionStatus` (`_lib/payments/icici/statusCheck.ts`),
 * which is implemented and unit-tested but not yet wired to any public
 * route (see docs/icici-orange-pg-integration.md §9).
 */

import { getIciciConfig } from '../../_lib/payments/icici/env.js';
import {
  createSupabaseClientFromEnv,
  createSupabasePaymentTransactionRepository,
  type PublicPaymentTransactionStatus,
} from '../../_lib/payments/icici/repository.js';

/**
 * Strict response allow-list, enforced at this route itself (not just by
 * trusting the repository's own SQL `select()`) — a second, independent
 * layer, so a future repository change can never widen what this
 * endpoint exposes without an explicit change here too.
 */
function toSafeResponse(transaction: PublicPaymentTransactionStatus) {
  return {
    merchantTxnNo: transaction.merchantTxnNo,
    status: transaction.status,
    amount: transaction.amount,
    currency: transaction.currency,
    responseDescription: transaction.responseDescription,
    paymentMode: transaction.paymentMode,
    paymentDatetime: transaction.paymentDatetime,
  };
}

interface ApiRequest {
  method?: string;
  headers: { origin?: string; [key: string]: string | string[] | undefined };
  query?: { merchantTxnNo?: string | string[] };
  url?: string;
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

  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Vary', 'Origin');

  if (!allowedOrigin || !requestOrigin) return true;
  if (requestOrigin === allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', requestOrigin);
    return true;
  }
  return false;
}

/** merchantTxnNo is generated server-side with a known safe alphabet — reject anything else before it ever reaches a query. */
const MERCHANT_TXN_NO_PATTERN = /^[A-Z0-9]{1,20}$/;

function extractMerchantTxnNo(request: ApiRequest): string | null {
  const raw = request.query?.merchantTxnNo;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !MERCHANT_TXN_NO_PATTERN.test(value)) return null;
  return value;
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const originOk = enforceOrigin(request, response);

  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'GET') {
    return response.status(405).json({ success: false, message: 'Method not allowed.' });
  }
  if (!originOk) {
    return response.status(403).json({ success: false, message: 'Request origin is not allowed.' });
  }

  const merchantTxnNo = extractMerchantTxnNo(request);
  if (!merchantTxnNo) {
    return response.status(400).json({ success: false, message: 'A valid merchantTxnNo is required.' });
  }

  try {
    // Confirms ICICI configuration (whichever environment is active) is
    // present; the status lookup itself never calls ICICI, but this keeps
    // the same fail-closed posture as the initiate route.
    getIciciConfig();

    const client = createSupabaseClientFromEnv();
    const repository = createSupabasePaymentTransactionRepository(client);

    const result = await repository.getPublicStatusByMerchantTxnNo(merchantTxnNo);

    if (!result) {
      return response.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    return response.status(200).json({ success: true, transaction: toSafeResponse(result) });
  } catch (error) {
    console.error('[ICICI STATUS ERROR]', error instanceof Error ? error.message : error);
    return response.status(503).json({ success: false, message: 'Unable to retrieve payment status right now.' });
  }
}
