import { afterEach, describe, expect, it } from 'vitest';
import { getIciciConfig, IciciConfigError } from './env';

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

  it('rejects ICICI_ENV=production outright — production is not enabled for this integration', () => {
    clearIciciEnv();
    process.env.ICICI_ENV = 'production';
    process.env.ICICI_MERCHANT_ID = 'test-merchant';
    process.env.ICICI_AGGREGATOR_ID = 'test-aggregator';
    process.env.ICICI_HASH_KEY = 'test-key';
    process.env.ICICI_RETURN_URL = 'https://example.test/return';

    expect(() => getIciciConfig()).toThrow(IciciConfigError);
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
});
