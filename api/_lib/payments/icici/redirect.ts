/**
 * Builds the final, safe URL to redirect the customer's browser to,
 * from a VALIDATED ICICI Initiate Sale response only.
 *
 * Per the documented Direct Orange PG redirect pattern (redirectURI +
 * ?tranCtx=...), this appends tranCtx as a query parameter — it does not
 * invent a different transport (no auto-submitting form, no POST body).
 *
 * Hard safety checks, all enforced server-side before any URL is ever
 * handed to the frontend:
 * - redirectURI must be a well-formed absolute URL
 * - must use HTTPS
 * - must belong to the hostname that matches the CALLER'S OWN environment
 *   (the UAT hostname for a UAT config, the production hostname only for
 *   a production config) — never the other, and never anything else.
 *   `environment` defaults to `'uat'`, the restrictive choice, so a call
 *   site that forgets to pass it can never accidentally accept a
 *   production-hosted redirect.
 * - the caller only ever passes redirectURI/tranCtx that came from an
 *   already-validated ICICI response (see initiateSaleResponse.ts) —
 *   this function never accepts anything derived from browser input.
 */

import { ICICI_PRODUCTION_HOSTNAME, ICICI_UAT_HOSTNAME, type IciciEnvironment } from './env';

export class IciciUnsafeRedirectError extends Error {}

export function buildIciciRedirectUrl(redirectURI: string, tranCtx: string, environment: IciciEnvironment = 'uat'): string {
  let url: URL;
  try {
    url = new URL(redirectURI);
  } catch {
    throw new IciciUnsafeRedirectError(`redirectURI is not a well-formed absolute URL: "${redirectURI}"`);
  }

  if (url.protocol !== 'https:') {
    throw new IciciUnsafeRedirectError(`redirectURI must use HTTPS; received protocol "${url.protocol}"`);
  }

  const expectedHostname = environment === 'production' ? ICICI_PRODUCTION_HOSTNAME : ICICI_UAT_HOSTNAME;

  if (url.hostname !== expectedHostname) {
    throw new IciciUnsafeRedirectError(
      `redirectURI host "${url.hostname}" does not match the expected ICICI host "${expectedHostname}" for environment "${environment}"`,
    );
  }

  url.searchParams.set('tranCtx', tranCtx);
  return url.toString();
}
