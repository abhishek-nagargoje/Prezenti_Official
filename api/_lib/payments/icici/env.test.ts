import { afterEach, describe, expect, it } from 'vitest';
import { getIciciConfig, IciciConfigError, ICICI_PRODUCTION_CONFIRMATION_VALUE } from './env';

const ICICI_ENV_KEYS = [
  'ICICI_ENV',
  'ICICI_MERCHANT_ID',
  'ICICI_AGGREGATOR_ID',
  'ICICI_HASH_KEY',
  'ICICI_CURRENCY_CODE',
  'ICICI_PAY_TYPE',
  'ICICI_TRANSACTION_TYPE',
  'ICICI_UAT_INITIATE_SALE_URL',
  'ICICI_UAT_COMMAND_URL',
  'ICICI_UAT_SETTLEMENT_DETAILS_URL',
  'ICICI_RETURN_URL',
  'ICICI_PRODUCTION_CONFIRM',
  'ICICI_PROD_MERCHANT_ID',
  'ICICI_PROD_AGGREGATOR_ID',
  'ICICI_PROD_HASH_KEY',
  'ICICI_PROD_INITIATE_SALE_URL',
  'ICICI_PROD_COMMAND_URL',
  'ICICI_PROD_SETTLEMENT_DETAILS_URL',
] as const;

function clearIciciEnv() {
  for (const key of ICICI_ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  clearIciciEnv();
});

describe('getIciciConfig', () => {
  it('throws when a required variable is missing, naming only the variable (never a value)', () => {
    clearIciciEnv();
    expect(() => getIciciConfig()).toThrow(IciciConfigError);
    try {
      getIciciConfig();
    } catch (error) {
      expect(error).toBeInstanceOf(IciciConfigError);
      expect((error as Error).message).toContain('ICICI_MERCHANT_ID');
    }
  });

  it('defaults ICICI_ENV to uat and defaults currency/payType/transactionType', () => {
    clearIciciEnv();
    process.env.ICICI_MERCHANT_ID = 'test-merchant';
    process.env.ICICI_AGGREGATOR_ID = 'test-aggregator';
    process.env.ICICI_HASH_KEY = 'test-key';
    process.env.ICICI_RETURN_URL = 'https://example.test/return';

    const config = getIciciConfig();

    expect(config.environment).toBe('uat');
    expect(config.currencyCode).toBe('356');
    expect(config.payType).toBe('0');
    expect(config.transactionType).toBe('SALE');
    expect(config.initiateSaleUrl).toBe('https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale');
  });

  it('reads ICICI_UAT_INITIATE_SALE_URL as the single source of truth for the endpoint override', () => {
    clearIciciEnv();
    process.env.ICICI_MERCHANT_ID = 'test-merchant';
    process.env.ICICI_AGGREGATOR_ID = 'test-aggregator';
    process.env.ICICI_HASH_KEY = 'test-key';
    process.env.ICICI_RETURN_URL = 'https://example.test/return';
    process.env.ICICI_UAT_INITIATE_SALE_URL = 'https://example.test/custom-initiate';

    expect(getIciciConfig().initiateSaleUrl).toBe('https://example.test/custom-initiate');
  });

  it('rejects ICICI_ENV=production without the ICICI_PRODUCTION_CONFIRM gate, even with valid ICICI_PROD_* credentials present', () => {
    clearIciciEnv();
    process.env.ICICI_ENV = 'production';
    process.env.ICICI_PROD_MERCHANT_ID = 'prod-merchant';
    process.env.ICICI_PROD_AGGREGATOR_ID = 'prod-aggregator';
    process.env.ICICI_PROD_HASH_KEY = 'prod-key';
    process.env.ICICI_RETURN_URL = 'https://example.test/return';
    // ICICI_PRODUCTION_CONFIRM intentionally left unset.

    expect(() => getIciciConfig()).toThrow(IciciConfigError);
  });

  it('rejects ICICI_ENV=production when ICICI_PRODUCTION_CONFIRM is set to the wrong value (no partial-credit matching)', () => {
    clearIciciEnv();
    process.env.ICICI_ENV = 'production';
    process.env.ICICI_PRODUCTION_CONFIRM = 'yes'; // not the exact required value
    process.env.ICICI_PROD_MERCHANT_ID = 'prod-merchant';
    process.env.ICICI_PROD_AGGREGATOR_ID = 'prod-aggregator';
    process.env.ICICI_PROD_HASH_KEY = 'prod-key';
    process.env.ICICI_RETURN_URL = 'https://example.test/return';

    expect(() => getIciciConfig()).toThrow(IciciConfigError);
  });

  it('still requires UAT-mode config for ICICI_ENV=uat to keep working exactly as before — production support never disturbs UAT', () => {
    clearIciciEnv();
    process.env.ICICI_MERCHANT_ID = 'test-merchant';
    process.env.ICICI_AGGREGATOR_ID = 'test-aggregator';
    process.env.ICICI_HASH_KEY = 'test-key';
    process.env.ICICI_RETURN_URL = 'https://example.test/return';

    const config = getIciciConfig();
    expect(config.environment).toBe('uat');
    expect(config.merchantId).toBe('test-merchant');
  });

  describe('ICICI_ENV=production, correctly and deliberately enabled', () => {
    function setValidProductionCredentials() {
      process.env.ICICI_ENV = 'production';
      process.env.ICICI_PRODUCTION_CONFIRM = ICICI_PRODUCTION_CONFIRMATION_VALUE;
      process.env.ICICI_PROD_MERCHANT_ID = 'prod-merchant';
      process.env.ICICI_PROD_AGGREGATOR_ID = 'prod-aggregator';
      process.env.ICICI_PROD_HASH_KEY = 'prod-key';
      process.env.ICICI_RETURN_URL = 'https://www.prezenti.com/api/payments/icici/return';
    }

    it('succeeds and resolves the real ICICI production endpoints', () => {
      clearIciciEnv();
      setValidProductionCredentials();

      const config = getIciciConfig();
      expect(config.environment).toBe('production');
      expect(config.merchantId).toBe('prod-merchant');
      expect(config.aggregatorId).toBe('prod-aggregator');
      expect(config.hashKey).toBe('prod-key');
      // Production paths do NOT carry the "/tsp" prefix UAT uses — confirmed
      // live (a GET to the /tsp/... path returned 404 from ICICI's own
      // production nginx). Only UAT uses "/tsp/pg/api/...".
      expect(config.initiateSaleUrl).toBe('https://pgpay.icicibank.com/pg/api/v2/initiateSale');
      expect(config.commandUrl).toBe('https://pgpay.icicibank.com/pg/api/command');
      expect(config.settlementDetailsUrl).toBe('https://pgpay.icicibank.com/pg/api/settlementDetails');
    });

    it('never falls back to UAT credentials (ICICI_MERCHANT_ID etc.) even if they happen to also be set', () => {
      clearIciciEnv();
      setValidProductionCredentials();
      process.env.ICICI_MERCHANT_ID = 'uat-merchant-should-never-be-used';

      expect(getIciciConfig().merchantId).toBe('prod-merchant');
    });

    it('still throws, naming only the missing ICICI_PROD_* variable, when a production credential is absent', () => {
      clearIciciEnv();
      process.env.ICICI_ENV = 'production';
      process.env.ICICI_PRODUCTION_CONFIRM = ICICI_PRODUCTION_CONFIRMATION_VALUE;
      process.env.ICICI_PROD_AGGREGATOR_ID = 'prod-aggregator';
      process.env.ICICI_PROD_HASH_KEY = 'prod-key';
      process.env.ICICI_RETURN_URL = 'https://example.test/return';
      // ICICI_PROD_MERCHANT_ID intentionally left unset.

      try {
        getIciciConfig();
        expect.unreachable('expected getIciciConfig to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(IciciConfigError);
        expect((error as Error).message).toContain('ICICI_PROD_MERCHANT_ID');
      }
    });
  });

  describe('ICICI_ENV is matched exactly — case is never normalized', () => {
    for (const badValue of ['Production', 'PRODUCTION', 'UAT', 'Uat']) {
      it(`rejects ICICI_ENV="${badValue}" rather than silently treating it as either valid value`, () => {
        clearIciciEnv();
        process.env.ICICI_ENV = badValue;
        process.env.ICICI_MERCHANT_ID = 'test-merchant';
        process.env.ICICI_AGGREGATOR_ID = 'test-aggregator';
        process.env.ICICI_HASH_KEY = 'test-key';
        process.env.ICICI_RETURN_URL = 'https://example.test/return';

        expect(() => getIciciConfig()).toThrow(IciciConfigError);
      });
    }
  });

  it('never includes the hash key value in a thrown error message', () => {
    clearIciciEnv();
    process.env.ICICI_HASH_KEY = 'super-secret-value-must-not-leak';

    try {
      getIciciConfig();
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-value-must-not-leak');
    }
  });

  describe('application deployment environment vs. ICICI gateway environment are independent', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousVercelEnv = process.env.VERCEL_ENV;

    afterEach(() => {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previousVercelEnv;
    });

    function setValidUatCredentials() {
      process.env.ICICI_MERCHANT_ID = 'test-merchant';
      process.env.ICICI_AGGREGATOR_ID = 'test-aggregator';
      process.env.ICICI_HASH_KEY = 'test-key';
      process.env.ICICI_RETURN_URL = 'https://example.test/return';
    }

    it('production website deployment + ICICI_ENV=uat => allowed (NODE_ENV/VERCEL_ENV=production alone never selects ICICI production)', () => {
      clearIciciEnv();
      process.env.NODE_ENV = 'production';
      process.env.VERCEL_ENV = 'production';
      setValidUatCredentials();
      // ICICI_ENV intentionally left unset — must still default to uat.

      const config = getIciciConfig();
      expect(config.environment).toBe('uat');
      expect(config.initiateSaleUrl).toBe('https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale');
    });

    it('production website deployment + ICICI_ENV=production => rejected (the app being in production never implicitly authorizes the ICICI production gateway)', () => {
      clearIciciEnv();
      process.env.NODE_ENV = 'production';
      process.env.VERCEL_ENV = 'production';
      process.env.ICICI_ENV = 'production';
      setValidUatCredentials();

      expect(() => getIciciConfig()).toThrow(IciciConfigError);
    });

    it('getIciciConfig never reads NODE_ENV or VERCEL_ENV to decide the ICICI environment — only ICICI_ENV', () => {
      clearIciciEnv();
      process.env.NODE_ENV = 'development';
      process.env.VERCEL_ENV = 'development';
      setValidUatCredentials();

      // Even with a non-production app environment, explicit ICICI_ENV=uat
      // is honored exactly the same way — the two are fully decoupled in
      // both directions.
      process.env.ICICI_ENV = 'uat';
      expect(getIciciConfig().environment).toBe('uat');
    });
  });
});
