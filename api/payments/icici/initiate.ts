/**
 * POST /api/payments/icici/initiate
 *
 * Starts an ICICI Direct Orange PG Initiate Sale flow. Reads all ICICI
 * and Supabase credentials from server-side environment variables only
 * (see api/_lib/payments/icici/env.ts and repository.ts) — never logs or
 * returns them. UAT only: getIciciConfig() throws if ICICI_ENV is set to
 * "production", and every outbound call is additionally host-checked in
 * httpClient.ts.
 *
 * NOTE: Prezenti's authoritative order/quote pricing does not exist yet,
 * so this endpoint always uses a fixed server-side UAT test amount
 * (ICICI_UAT_TEST_AMOUNT, "2.00") — it never reads an amount from the
 * request body. See initiateSaleService.ts.
 */

import { getIciciConfig, IciciConfigError } from '../../_lib/payments/icici/env.js';
import { initiateIciciPayment, IciciInitiateSaleValidationError } from '../../_lib/payments/icici/initiateSaleService.js';
import {
  createSupabaseClientFromEnv,
  createSupabasePaymentTransactionRepository,
} from '../../_lib/payments/icici/repository.js';

interface ApiRequest {
  method?: string;
  headers: { origin?: string; 'content-type'?: string | string[]; [key: string]: string | string[] | undefined };
  body?: unknown;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(statusCode: number): ApiResponse;
  json(body: unknown): void;
  end(): void;
}

interface InitiateRequestBody {
  internalReference?: unknown;
  customerEmailID?: unknown;
  customerMobileNo?: unknown;
  customerName?: unknown;
}

const maxJsonBodyBytes = 8_000;

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

function readBody(body: unknown): InitiateRequestBody {
  if (typeof body === 'string') {
    if (body.length > maxJsonBodyBytes) throw new Error('Request body is too large.');
    return JSON.parse(body) as InitiateRequestBody;
  }
  if (body && typeof body === 'object') {
    if (JSON.stringify(body).length > maxJsonBodyBytes) throw new Error('Request body is too large.');
    return body as InitiateRequestBody;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

  let body: InitiateRequestBody;
  try {
    body = readBody(request.body);
  } catch {
    return response.status(400).json({ success: false, message: 'Invalid request body.' });
  }

  const input = {
    internalReference: asString(body.internalReference),
    customerEmailID: asString(body.customerEmailID),
    customerMobileNo: asString(body.customerMobileNo),
    customerName: asString(body.customerName),
  };

  let config;
  try {
    config = getIciciConfig();
  } catch (error) {
    // Never surface *which* variable or *what* value is missing/invalid to
    // the client — only that the gateway is not configured.
    if (error instanceof IciciConfigError) {
      console.error('[ICICI CONFIG ERROR]', error.message);
    } else {
      console.error('[ICICI CONFIG ERROR] unexpected', error);
    }
    return response.status(503).json({ success: false, message: 'Payment gateway is not available right now.' });
  }

  let repository;
  try {
    const client = createSupabaseClientFromEnv();
    repository = createSupabasePaymentTransactionRepository(client);
  } catch (error) {
    console.error('[ICICI REPOSITORY CONFIG ERROR]', error instanceof Error ? error.message : error);
    return response.status(503).json({ success: false, message: 'Payment gateway is not available right now.' });
  }

  try {
    const result = await initiateIciciPayment(input, { config, repository });

    // Log only the redacted preview and outcome — never the raw ICICI
    // response body (may include fields we haven't audited) and never
    // any credential. rawResponseDescription is ICICI's own
    // human-readable rejection reason (e.g. "Invalid request: Secure
    // hash does not match") — safe, non-secret diagnostic text, never
    // the secureHash value itself or any credential.
    console.info('[ICICI INITIATE]', {
      merchantTxnNo: result.safeResult.merchantTxnNo,
      httpStatus: result.httpStatus,
      rawResponseCode: result.rawResponseCode,
      rawResponseDescription: result.rawResponseDescription,
      success: result.safeResult.success,
    });

    // TEMPORARY forensic logging for the "R1000 but success:false"
    // investigation — see IciciInitiateSaleServiceResult.diagnostic doc
    // comment. Safe: booleans, field names, generic reason strings, and a
    // redirect HOSTNAME only. Remove once the root cause is confirmed.
    if (result.diagnostic) {
      console.info('[ICICI INITIATE DIAGNOSTIC]', result.diagnostic);
    }

    if (result.safeResult.success) {
      return response.status(200).json(result.safeResult);
    }

    // PERSISTENCE (our own DB unreachable) is a 503 — same family as the
    // config-unavailable checks above. Everything else (ICICI rejected the
    // request, or a network/transport failure reaching ICICI) is a 502 —
    // the upstream gateway is the problem, not this route.
    const statusCode = result.errorKind === 'PERSISTENCE' ? 503 : 502;
    return response.status(statusCode).json(result.safeResult);
  } catch (error) {
    if (error instanceof IciciInitiateSaleValidationError) {
      return response.status(400).json({ success: false, message: 'Missing required payment details.' });
    }

    console.error('[ICICI INITIATE ERROR]', error instanceof Error ? error.message : error);
    return response.status(500).json({ success: false, message: 'Unable to initiate payment.' });
  }
}
