/**
 * Outbound HTTP client for calling ICICI. Isolated so it is the single
 * place actual network I/O happens, and the single place the UAT-only
 * safety guard lives — every call, regardless of caller, is checked
 * against the UAT hostname before any request leaves the process.
 */

import { ICICI_PRODUCTION_HOSTNAMES, ICICI_UAT_HOSTNAME } from './env';
import type { IciciInitiateSaleRequestBody } from './requestBuilder';
import type { IciciInitiateSaleResponse } from './initiateSaleResponse';
import type { IciciStatusCheckResponse } from './statusCheck';

/** Default request timeout for all outbound ICICI calls — the bank's API has no documented SLA, so a conservative, explicit bound is used rather than relying on Vercel's own function timeout. */
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export class IciciRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`ICICI request timed out after ${timeoutMs}ms. Do not blindly retry — use STATUS/reconciliation instead.`);
  }
}

export class IciciProductionCallBlockedError extends Error {
  constructor(hostname: string) {
    super(
      `Refused to call "${hostname}": this integration is only permitted to call the UAT host ` +
        `"${ICICI_UAT_HOSTNAME}". Production calls are not enabled (see docs/icici-orange-pg-integration.md §4).`,
    );
  }
}

export class IciciUnexpectedHostError extends Error {
  constructor(hostname: string) {
    super(
      `Refused to call "${hostname}": only the UAT host "${ICICI_UAT_HOSTNAME}" is currently permitted.`,
    );
  }
}

/** Throws if `url` is not exactly the permitted UAT hostname. This is the hard guard against an accidental production call. */
export function assertIciciUatHost(url: string): void {
  const hostname = new URL(url).hostname;

  if (ICICI_PRODUCTION_HOSTNAMES.includes(hostname)) {
    throw new IciciProductionCallBlockedError(hostname);
  }

  if (hostname !== ICICI_UAT_HOSTNAME) {
    throw new IciciUnexpectedHostError(hostname);
  }
}

export interface IciciInitiateSaleHttpResult {
  httpStatus: number;
  body: IciciInitiateSaleResponse | null;
  /** Present when the response body could not be parsed as JSON. */
  parseError?: string;
}

/**
 * POSTs the Initiate Sale request body to `url` as JSON. Enforces the
 * UAT-only host guard before sending anything. Never logs `requestBody`
 * (it contains no secret, but customer PII) or any header value. Aborts
 * after `timeoutMs` — a timeout must never be silently retried by the
 * caller; the transaction stays PENDING/UNKNOWN until reconciled via
 * STATUS (the bank may have received the request even if the response
 * never arrived).
 */
export async function postIciciInitiateSale(
  url: string,
  requestBody: IciciInitiateSaleRequestBody,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<IciciInitiateSaleHttpResult> {
  assertIciciUatHost(url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new IciciRequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();

  try {
    const body = rawText.length > 0 ? (JSON.parse(rawText) as IciciInitiateSaleResponse) : null;
    return { httpStatus: response.status, body };
  } catch (error) {
    return {
      httpStatus: response.status,
      body: null,
      parseError: error instanceof Error ? error.message : 'Unknown JSON parse error',
    };
  }
}

export interface IciciCommandHttpResult {
  httpStatus: number;
  body: IciciStatusCheckResponse | null;
  /** Present when the response body could not be parsed as JSON. */
  parseError?: string;
}

/**
 * POSTs a Command-endpoint request (STATUS, Refund, etc.) to `url` as
 * `application/x-www-form-urlencoded` (doc-confirmed transport for this
 * endpoint family). Enforces the same UAT-only host guard and timeout
 * behavior as `postIciciInitiateSale`. `fields` values are URL-encoded
 * exactly as given — no reformatting.
 */
export async function postIciciCommand(
  url: string,
  fields: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<IciciCommandHttpResult> {
  assertIciciUatHost(url);

  const body = new URLSearchParams(fields).toString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new IciciRequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();

  try {
    const parsedBody = rawText.length > 0 ? (JSON.parse(rawText) as IciciStatusCheckResponse) : null;
    return { httpStatus: response.status, body: parsedBody };
  } catch (error) {
    return {
      httpStatus: response.status,
      body: null,
      parseError: error instanceof Error ? error.message : 'Unknown JSON parse error',
    };
  }
}
