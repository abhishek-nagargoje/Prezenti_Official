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

/**
 * The exact, case-sensitive value `ICICI_PRODUCTION_CONFIRM` must equal
 * for `ICICI_ENV=production` to actually take effect. This is a
 * deliberate second gate: `ICICI_ENV=production` alone is never
 * sufficient to enable real ICICI production payments — both variables
 * must be set, on purpose, at the same time. Knowing this value alone
 * grants no access (it is not a credential); it exists purely so a
 * single stray/copied `ICICI_ENV=production` can never silently go live.
 */
export const ICICI_PRODUCTION_CONFIRMATION_VALUE = 'yes-enable-icici-production';

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
// NOTE: production paths do NOT carry the "/tsp" prefix UAT uses — this
// was a real bug (confirmed live: a GET to .../tsp/pg/api/v2/initiateSale
// returned 404 from ICICI's own production nginx). The official spec's
// production path is "/pg/api/..." — UAT is the only environment that
// uses "/tsp/pg/api/...".
const PROD_DEFAULT_INITIATE_SALE_URL = 'https://pgpay.icicibank.com/pg/api/v2/initiateSale';
const PROD_DEFAULT_COMMAND_URL = 'https://pgpay.icicibank.com/pg/api/command';
const PROD_DEFAULT_SETTLEMENT_DETAILS_URL = 'https://pgpay.icicibank.com/pg/api/settlementDetails';

function getUatIciciConfig(): IciciConfig {
  return {
    environment: 'uat',
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

/**
 * Production credentials are read from entirely separate variable names
 * (`ICICI_PROD_*`, never `ICICI_*`) — UAT and production are different
 * bank-issued credentials and must never be able to collide or be
 * silently reused across environments. `requireEnv` throwing here (e.g.
 * because only UAT credentials happen to be configured) is the correct,
 * fail-closed behavior, not a bug to work around.
 */
function getProductionIciciConfig(): IciciConfig {
  const confirmation = process.env.ICICI_PRODUCTION_CONFIRM;
  if (confirmation !== ICICI_PRODUCTION_CONFIRMATION_VALUE) {
    throw new IciciConfigError(
      'ICICI_ENV=production requires a second, deliberate confirmation variable (ICICI_PRODUCTION_CONFIRM) set to ' +
        'the exact documented value. ICICI_ENV=production alone is never sufficient to enable real ICICI production ' +
        'payments — see docs/icici-orange-pg-integration.md.',
    );
  }

  return {
    environment: 'production',
    merchantId: requireEnv('ICICI_PROD_MERCHANT_ID'),
    aggregatorId: requireEnv('ICICI_PROD_AGGREGATOR_ID'),
    hashKey: requireEnv('ICICI_PROD_HASH_KEY'),
    currencyCode: process.env.ICICI_CURRENCY_CODE ?? '356',
    payType: process.env.ICICI_PAY_TYPE ?? '0',
    transactionType: process.env.ICICI_TRANSACTION_TYPE ?? 'SALE',
    initiateSaleUrl: process.env.ICICI_PROD_INITIATE_SALE_URL ?? PROD_DEFAULT_INITIATE_SALE_URL,
    commandUrl: process.env.ICICI_PROD_COMMAND_URL ?? PROD_DEFAULT_COMMAND_URL,
    settlementDetailsUrl: process.env.ICICI_PROD_SETTLEMENT_DETAILS_URL ?? PROD_DEFAULT_SETTLEMENT_DETAILS_URL,
    returnUrl: requireEnv('ICICI_RETURN_URL'),
  };
}

/**
 * Loads and validates server-side ICICI configuration. Throws
 * `IciciConfigError` (naming only the missing variable, never any value)
 * if a required variable is absent. Does not memoize — callers needing
 * this repeatedly should cache the result themselves within a request.
 *
 * `ICICI_ENV` is matched exactly and case-sensitively against `"uat"` or
 * `"production"` — values like `"UAT"`/`"Production"`/`"PRODUCTION"` are
 * intentionally NOT normalized and are rejected outright, so a
 * differently-cased value can never silently fall through to either
 * branch.
 */
export function getIciciConfig(): IciciConfig {
  const environment = (process.env.ICICI_ENV ?? 'uat') as IciciEnvironment;
  if (environment !== 'uat' && environment !== 'production') {
    throw new IciciConfigError(
      `ICICI_ENV must be exactly "uat" or "production" (case-sensitive, not normalized); received "${environment}".`,
    );
  }

  return environment === 'production' ? getProductionIciciConfig() : getUatIciciConfig();
}

// Exported for documentation/tests — these are the real, live ICICI
// production endpoints. They are only ever assigned to a config's
// initiateSaleUrl/commandUrl/settlementDetailsUrl when getIciciConfig()
// has already passed the ICICI_PRODUCTION_CONFIRM gate above.
export const ICICI_PRODUCTION_DEFAULT_URLS = {
  initiateSaleUrl: PROD_DEFAULT_INITIATE_SALE_URL,
  commandUrl: PROD_DEFAULT_COMMAND_URL,
  settlementDetailsUrl: PROD_DEFAULT_SETTLEMENT_DETAILS_URL,
};

/** The only hostname this integration is permitted to call while ICICI_ENV=uat. Used as a hard outbound guard. */
export const ICICI_UAT_HOSTNAME = 'pgpayuat.icicibank.com';

/**
 * The only hostname this integration is permitted to call (the outbound
 * Initiate Sale / Command / Settlement API host) while ICICI_ENV=production
 * (and only once the production-confirm gate has passed). Distinct from
 * `ICICI_PRODUCTION_REDIRECT_HOSTNAMES` below — the API host and the
 * hosted-payment-page redirect host are confirmed (live, production
 * traffic) to be different ICICI domains; this constant is the API host
 * only and must not be conflated with the redirect allow-list.
 */
export const ICICI_PRODUCTION_HOSTNAME = 'pgpay.icicibank.com';

/** Every known ICICI production hostname — used by the UAT-mode host guard to positively (and specifically) refuse an accidental production call, rather than reporting it as merely "unexpected". */
export const ICICI_PRODUCTION_HOSTNAMES = [ICICI_PRODUCTION_HOSTNAME];

/**
 * Every hostname ICICI is confirmed to use for the hosted Direct Orange
 * payment page redirect target when `environment === 'production'` — used
 * exclusively by `redirect.ts`'s exact-match allow-list, never for the
 * outbound API call guard (see `ICICI_PRODUCTION_HOSTNAME` above).
 *
 * `pgpay.icicibank.com` — the documented/expected redirect host.
 * `pgpay.icici.bank.in` — confirmed live: a real ICICI production R1000
 * response's `redirectURI` used this hostname (verified via this
 * integration's own forensic diagnostic logging against real production
 * traffic, not assumed from the UAT pattern alone). Exact hostname
 * matching only — no wildcard/subdomain matching is performed against
 * either domain.
 */
export const ICICI_PRODUCTION_REDIRECT_HOSTNAMES = ['pgpay.icicibank.com', 'pgpay.icici.bank.in'] as const;
