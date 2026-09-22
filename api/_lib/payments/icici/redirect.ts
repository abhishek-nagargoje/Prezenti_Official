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
 * - must belong to a hostname on the EXACT allow-list for the caller's
 *   own environment (the single UAT hostname for a UAT config; for a
 *   production config, `ICICI_PRODUCTION_REDIRECT_HOSTNAMES` — confirmed
 *   via live production traffic to be more than one real ICICI domain,
 *   since the hosted-payment-page host differs from the API call host)
 *   — never a hostname from the other environment, and never anything
 *   else. Matching is always exact string equality against one of the
 *   listed hostnames — no wildcard, suffix, or subdomain matching is ever
 *   performed, so `evil-pgpay.icicibank.com.attacker.example` or similar
 *   can never pass. `environment` defaults to `'uat'`, the restrictive
 *   choice, so a call site that forgets to pass it can never accidentally
 *   accept a production-hosted redirect.
 * - the caller only ever passes redirectURI/tranCtx that came from an
 *   already-validated ICICI response (see initiateSaleResponse.ts) —
 *   this function never accepts anything derived from browser input.
 */

import { ICICI_PRODUCTION_REDIRECT_HOSTNAMES, ICICI_UAT_HOSTNAME, type IciciEnvironment } from './env.js';

export class IciciUnsafeRedirectError extends Error {}

function allowedRedirectHostnames(environment: IciciEnvironment): readonly string[] {
  return environment === 'production' ? ICICI_PRODUCTION_REDIRECT_HOSTNAMES : [ICICI_UAT_HOSTNAME];
}

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

  const allowedHostnames = allowedRedirectHostnames(environment);

  if (!allowedHostnames.includes(url.hostname)) {
    throw new IciciUnsafeRedirectError(
      `redirectURI host "${url.hostname}" is not in the allowed list [${allowedHostnames.join(', ')}] for environment "${environment}"`,
    );
  }

  url.searchParams.set('tranCtx', tranCtx);
  return url.toString();
}
