/**
 * Outbound HTTP client for calling ICICI. Isolated so it is the single
 * place actual network I/O happens, and the single place the
 * environment/hostname safety guard lives — every call, regardless of
 * caller, is checked against the hostname that matches the *caller's own
 * declared environment* before any request leaves the process. A UAT
 * config can only ever reach the UAT host; a production config can only
 * ever reach the production host — never the other, and never anything
 * else. Callers that omit `environment` default to `'uat'`, the
 * restrictive choice, so a call site that forgets to pass it can never
 * accidentally permit a production call.
 */

import { ICICI_PRODUCTION_HOSTNAMES, ICICI_PRODUCTION_HOSTNAME, ICICI_UAT_HOSTNAME, type IciciEnvironment } from './env.js';
import type { IciciInitiateSaleRequestBody } from './requestBuilder.js';
import type { IciciInitiateSaleResponse } from './initiateSaleResponse.js';
import type { IciciStatusCheckResponse } from './statusCheck.js';

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
      `Refused to call "${hostname}": the current ICICI environment is "uat", which is only permitted to call ` +
        `the UAT host "${ICICI_UAT_HOSTNAME}". This call would have reached ICICI's production host instead — ` +
        `blocked outright rather than assuming that was intentional.`,
    );
  }
}

export class IciciUnexpectedHostError extends Error {
  constructor(hostname: string, environment: IciciEnvironment) {
    const expected = environment === 'production' ? ICICI_PRODUCTION_HOSTNAME : ICICI_UAT_HOSTNAME;
    super(`Refused to call "${hostname}": only "${expected}" is permitted while ICICI_ENV=${environment}.`);
  }
}

/**
 * Throws unless `url`'s hostname is exactly the one hostname permitted
 * for `environment` — the UAT host while `environment === 'uat'`, the
 * production host only while `environment === 'production'`. This is the
 * hard guard against ever reaching the wrong ICICI environment,
 * regardless of what URL a config/caller happens to compute.
 */
export function assertIciciHostMatchesEnvironment(url: string, environment: IciciEnvironment): void {
  const hostname = new URL(url).hostname;

  if (environment === 'production') {
    if (hostname === ICICI_PRODUCTION_HOSTNAME) return;
    throw new IciciUnexpectedHostError(hostname, environment);
  }

  if (hostname === ICICI_UAT_HOSTNAME) return;

  if (ICICI_PRODUCTION_HOSTNAMES.includes(hostname)) {
    throw new IciciProductionCallBlockedError(hostname);
  }

  throw new IciciUnexpectedHostError(hostname, environment);
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
  environment: IciciEnvironment = 'uat',
): Promise<IciciInitiateSaleHttpResult> {
  assertIciciHostMatchesEnvironment(url, environment);

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
  environment: IciciEnvironment = 'uat',
): Promise<IciciCommandHttpResult> {
  assertIciciHostMatchesEnvironment(url, environment);

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
