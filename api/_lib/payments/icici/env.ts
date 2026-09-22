/**
 * Server-side-only ICICI environment configuration loader.
 *
 * Reads process.env exclusively — this file must never be imported by
 * frontend/browser code, and none of these variable names may ever be
 * prefixed VITE_/NEXT_PUBLIC_/PUBLIC_. `ICICI_HASH_KEY` in particular is
 * never logged, never included in error messages, and never returned by
 * anything other than `getIciciConfig().hashKey` itself.
 */

export type IciciEnvironment = 'uat' | 'production';

export interface IciciConfig {
  environment: IciciEnvironment;
  merchantId: string;
  aggregatorId: string;
  /** ICICI-issued hash key, treated as UTF-8 bytes per the confirmed HMAC scheme. Never log this value. */
  hashKey: string;
  currencyCode: string;
  payType: string;
  transactionType: string;
  initiateSaleUrl: string;
  commandUrl: string;
  settlementDetailsUrl: string;
  returnUrl: string;
}

export class IciciConfigError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new IciciConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

const UAT_DEFAULT_INITIATE_SALE_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale';
const UAT_DEFAULT_COMMAND_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/command';
const UAT_DEFAULT_SETTLEMENT_DETAILS_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/settlementDetails';
const PROD_DEFAULT_INITIATE_SALE_URL = 'https://pgpay.icicibank.com/pg/api/v2/initiateSale';
const PROD_DEFAULT_COMMAND_URL = 'https://pgpay.icicibank.com/pg/api/command';

/**
 * Loads and validates server-side ICICI configuration. Throws
 * `IciciConfigError` (naming only the missing variable, never any value)
 * if a required variable is absent. Does not memoize — callers needing
 * this repeatedly should cache the result themselves within a request.
 */
export function getIciciConfig(): IciciConfig {
  const environment = (process.env.ICICI_ENV ?? 'uat') as IciciEnvironment;
  if (environment !== 'uat' && environment !== 'production') {
    throw new IciciConfigError(`ICICI_ENV must be "uat" or "production"; received "${environment}".`);
  }

  // Production must never be reachable unless explicitly and deliberately
  // configured — this integration has not been approved for production
  // use yet (see docs/icici-orange-pg-integration.md §4).
  if (environment === 'production') {
    throw new IciciConfigError(
      'ICICI_ENV=production is not enabled for this integration. Production credentials must not be used ' +
        'until UAT is verified, the bank has confirmed UAT results, and production configuration is explicitly approved.',
    );
  }

  return {
    environment,
    merchantId: requireEnv('ICICI_MERCHANT_ID'),
    aggregatorId: requireEnv('ICICI_AGGREGATOR_ID'),
    hashKey: requireEnv('ICICI_HASH_KEY'),
    currencyCode: process.env.ICICI_CURRENCY_CODE ?? '356',
    payType: process.env.ICICI_PAY_TYPE ?? '0',
    transactionType: process.env.ICICI_TRANSACTION_TYPE ?? 'SALE',
    // ICICI_UAT_* is the single canonical name (per the authoritative UAT
    // configuration spec) — no non-UAT-prefixed fallback is read anymore,
    // so there is exactly one source of truth for these three URLs.
    initiateSaleUrl: process.env.ICICI_UAT_INITIATE_SALE_URL ?? UAT_DEFAULT_INITIATE_SALE_URL,
    commandUrl: process.env.ICICI_UAT_COMMAND_URL ?? UAT_DEFAULT_COMMAND_URL,
    settlementDetailsUrl: process.env.ICICI_UAT_SETTLEMENT_DETAILS_URL ?? UAT_DEFAULT_SETTLEMENT_DETAILS_URL,
    returnUrl: requireEnv('ICICI_RETURN_URL'),
  };
}

// Exported for documentation/tests only — not used to silently enable
// production; getIciciConfig() above hard-rejects ICICI_ENV=production.
export const ICICI_PRODUCTION_DEFAULT_URLS = {
  initiateSaleUrl: PROD_DEFAULT_INITIATE_SALE_URL,
  commandUrl: PROD_DEFAULT_COMMAND_URL,
};

/** The only hostname this integration is currently permitted to call. Used as a hard outbound guard. */
export const ICICI_UAT_HOSTNAME = 'pgpayuat.icicibank.com';

/** Every known ICICI production hostname — used to positively refuse an accidental production call. */
export const ICICI_PRODUCTION_HOSTNAMES = ['pgpay.icicibank.com'];
