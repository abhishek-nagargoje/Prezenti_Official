import { describe, expect, it, vi } from 'vitest';
import {
  ICICI_UAT_TEST_AMOUNT,
  IciciInitiateSaleValidationError,
  initiateIciciPayment,
  type IciciInitiateSaleServiceDeps,
} from './initiateSaleService';
import type { IciciConfig } from './env';
import type { PaymentTransactionRepository } from './repository';

const CONFIG: IciciConfig = {
  environment: 'uat',
  merchantId: '100000000007164',
  aggregatorId: 'A100000000007164',
  hashKey: 'test-fixture-key-not-a-real-secret',
  currencyCode: '356',
  payType: '0',
  transactionType: 'SALE',
  initiateSaleUrl: 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale',
  commandUrl: 'https://pgpayuat.icicibank.com/tsp/pg/api/command',
  settlementDetailsUrl: 'https://pgpayuat.icicibank.com/tsp/pg/api/settlementDetails',
  returnUrl: 'https://prezenti.com/api/payments/icici/return',
};

const VALID_INPUT = {
  internalReference: 'QUOTE-001',
  customerEmailID: 'customer@example.com',
  customerMobileNo: '919876543210',
  customerName: 'Test Customer',
};

function createFakeRepository(): PaymentTransactionRepository & {
  createInitiatedTransaction: ReturnType<typeof vi.fn>;
  recordInitiateSaleOutcome: ReturnType<typeof vi.fn>;
  getPublicStatusByMerchantTxnNo: ReturnType<typeof vi.fn>;
  recordCallback: ReturnType<typeof vi.fn>;
} {
  return {
    createInitiatedTransaction: vi.fn().mockResolvedValue(undefined),
    recordInitiateSaleOutcome: vi.fn().mockResolvedValue(undefined),
    getPublicStatusByMerchantTxnNo: vi.fn().mockResolvedValue(null),
    recordCallback: vi.fn().mockResolvedValue(undefined),
  };
}

function jsonFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ status, text: async () => JSON.stringify(body) });
}

/**
 * Builds an R1000-accepted mock response that echoes back whatever
 * merchantTxnNo Prezenti actually sent (generated randomly per call),
 * exactly as the real ICICI response does.
 */
function acceptedJsonFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
    const sentBody = JSON.parse(init.body) as { merchantTxnNo: string };
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          responseCode: 'R1000',
          merchantId: CONFIG.merchantId,
          aggregatorID: CONFIG.aggregatorId,
          merchantTxnNo: sentBody.merchantTxnNo,
          redirectURI: 'https://pgpayuat.icicibank.com/tsp/pg/somepage',
          tranCtx: 'ctx-abc',
          ...overrides,
        }),
    };
  });
}

describe('initiateIciciPayment', () => {
  it('rejects missing required input before generating anything or touching the repository', async () => {
    const repository = createFakeRepository();
    const deps: IciciInitiateSaleServiceDeps = { config: CONFIG, repository, fetchImpl: vi.fn() };

    await expect(
      initiateIciciPayment({ ...VALID_INPUT, customerEmailID: '' }, deps),
    ).rejects.toThrow(IciciInitiateSaleValidationError);
    expect(repository.createInitiatedTransaction).not.toHaveBeenCalled();
  });

  it('always uses the fixed UAT test amount, never anything from caller input', async () => {
    const repository = createFakeRepository();
    const fetchImpl = acceptedJsonFetch();

    // Note: IciciInitiateSaleServiceInput has no amount field — this also
    // proves at the type level that a caller cannot supply one.
    await initiateIciciPayment(VALID_INPUT, { config: CONFIG, repository, fetchImpl });

    expect(repository.createInitiatedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: ICICI_UAT_TEST_AMOUNT }),
    );
    expect(ICICI_UAT_TEST_AMOUNT).toBe('2.00');
  });

  it('persists INITIATED status and returns only safe fields on an accepted R1000 response', async () => {
    const repository = createFakeRepository();
    const fetchImpl = acceptedJsonFetch();

    const result = await initiateIciciPayment(VALID_INPUT, { config: CONFIG, repository, fetchImpl });

    expect(result.safeResult.success).toBe(true);
    // redirectURI comes back with tranCtx safely appended by buildIciciRedirectUrl.
    expect(result.safeResult.redirectURI).toBe('https://pgpayuat.icicibank.com/tsp/pg/somepage?tranCtx=ctx-abc');
    expect(result.safeResult.tranCtx).toBe('ctx-abc');
    expect(result.safeResult.merchantTxnNo).toMatch(/^PZ/);

    expect(repository.recordInitiateSaleOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'INITIATED', tranCtx: 'ctx-abc' }),
    );
  });

  it('never includes the hash key, config, or raw gateway response in the safe result', async () => {
    const repository = createFakeRepository();
    const fetchImpl = acceptedJsonFetch();

    const result = await initiateIciciPayment(VALID_INPUT, { config: CONFIG, repository, fetchImpl });

    const serialized = JSON.stringify(result.safeResult);
    expect(serialized).not.toContain(CONFIG.hashKey);
    expect(Object.keys(result.safeResult).sort()).toEqual(
      ['merchantTxnNo', 'redirectURI', 'success', 'tranCtx'].sort(),
    );
  });

  it('marks the transaction FAILED and returns success:false when ICICI rejects the request', async () => {
    const repository = createFakeRepository();
    const fetchImpl = jsonFetch(200, { responseCode: 'R1001', merchantId: CONFIG.merchantId, aggregatorID: CONFIG.aggregatorId });

    const result = await initiateIciciPayment(VALID_INPUT, { config: CONFIG, repository, fetchImpl });

    expect(result.safeResult.success).toBe(false);
    expect(repository.recordInitiateSaleOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });

  it('marks the transaction UNKNOWN (never FAILED or SUCCESS) on a malformed/non-JSON gateway response', async () => {
    const repository = createFakeRepository();
    const fetchImpl = vi.fn().mockResolvedValue({ status: 502, text: async () => '<html>Bad Gateway</html>' });

    const result = await initiateIciciPayment(VALID_INPUT, { config: CONFIG, repository, fetchImpl });

    expect(result.safeResult.success).toBe(false);
    expect(repository.recordInitiateSaleOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'UNKNOWN' }));
  });

  it('never returns a redirectURI and marks the transaction UNKNOWN if ICICI returns a non-UAT-host redirectURI', async () => {
    const repository = createFakeRepository();
    const fetchImpl = acceptedJsonFetch({ redirectURI: 'https://evil.example.com/steal-card-details' });

    const result = await initiateIciciPayment(VALID_INPUT, { config: CONFIG, repository, fetchImpl });

    expect(result.safeResult.success).toBe(false);
    expect(result.safeResult.redirectURI).toBeUndefined();
    expect(repository.recordInitiateSaleOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'UNKNOWN' }));
  });

  it('builds a redacted preview that never contains the hash key', async () => {
    const repository = createFakeRepository();
    const fetchImpl = acceptedJsonFetch();

    const result = await initiateIciciPayment(VALID_INPUT, { config: CONFIG, repository, fetchImpl });

    expect(JSON.stringify(result.preview)).not.toContain(CONFIG.hashKey);
    expect(result.preview.hashKeyIncluded).toBe(false);
  });
});
