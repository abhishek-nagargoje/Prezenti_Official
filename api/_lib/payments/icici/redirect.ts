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
 * - must belong to the confirmed ICICI UAT hostname (ICICI_UAT_HOSTNAME)
 * - the caller only ever passes redirectURI/tranCtx that came from an
 *   already-validated ICICI response (see initiateSaleResponse.ts) —
 *   this function never accepts anything derived from browser input.
 */

import { ICICI_UAT_HOSTNAME } from './env';

export class IciciUnsafeRedirectError extends Error {}

export function buildIciciRedirectUrl(redirectURI: string, tranCtx: string): string {
  let url: URL;
  try {
    url = new URL(redirectURI);
  } catch {
    throw new IciciUnsafeRedirectError(`redirectURI is not a well-formed absolute URL: "${redirectURI}"`);
  }

  if (url.protocol !== 'https:') {
    throw new IciciUnsafeRedirectError(`redirectURI must use HTTPS; received protocol "${url.protocol}"`);
  }

  if (url.hostname !== ICICI_UAT_HOSTNAME) {
    throw new IciciUnsafeRedirectError(
      `redirectURI host "${url.hostname}" does not match the expected ICICI UAT host "${ICICI_UAT_HOSTNAME}"`,
    );
  }

  url.searchParams.set('tranCtx', tranCtx);
  return url.toString();
}
