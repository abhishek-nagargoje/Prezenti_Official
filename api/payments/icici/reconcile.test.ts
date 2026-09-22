import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPublicStatusByMerchantTxnNo = vi.fn();
const mockRecordCallback = vi.fn();
const mockCheckIciciTransactionStatus = vi.fn();

vi.mock('../../_lib/payments/icici/repository', () => ({
  createSupabaseClientFromEnv: () => ({}),
  createSupabasePaymentTransactionRepository: () => ({
    getPublicStatusByMerchantTxnNo: (...args: unknown[]) => mockGetPublicStatusByMerchantTxnNo(...args),
    recordCallback: (...args: unknown[]) => mockRecordCallback(...args),
  }),
}));

vi.mock('../../_lib/payments/icici/statusCheck', async () => {
  const actual = await vi.importActual<typeof import('../../_lib/payments/icici/statusCheck')>(
    '../../_lib/payments/icici/statusCheck',
  );
  return {
    ...actual,
    checkIciciTransactionStatus: (...args: unknown[]) => mockCheckIciciTransactionStatus(...args),
  };
});

const { default: handler } = await import('./reconcile');

function createResponse() {
  const state = { statusCode: 0, jsonBody: undefined as unknown, ended: false };
  const response = {
    setHeader: vi.fn(),
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      state.jsonBody = body;
    }),
    end: vi.fn(() => {
      state.ended = true;
    }),
  };
  return { response, state };
}

const LOCAL_PENDING = {
  merchantTxnNo: 'PZ123ABC',
  status: 'INITIATED',
  amount: '2.00',
  currency: '356',
};

const LOCAL_SUCCESS = { ...LOCAL_PENDING, status: 'SUCCESS' };

describe('POST /api/payments/icici/reconcile', () => {
  beforeEach(() => {
    mockGetPublicStatusByMerchantTxnNo.mockReset().mockResolvedValue(LOCAL_PENDING);
    mockRecordCallback.mockReset().mockResolvedValue(undefined);
    mockCheckIciciTransactionStatus.mockReset();
    process.env.ICICI_ENV = 'uat';
    process.env.ICICI_MERCHANT_ID = '100000000007164';
    process.env.ICICI_AGGREGATOR_ID = 'A100000000007164';
    process.env.ICICI_HASH_KEY = 'test-fixture-key-not-a-real-secret';
    process.env.ICICI_RETURN_URL = 'https://prezenti.com/api/payments/icici/return';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ICICI_ENV;
    delete process.env.ICICI_MERCHANT_ID;
    delete process.env.ICICI_AGGREGATOR_ID;
    delete process.env.ICICI_HASH_KEY;
    delete process.env.ICICI_RETURN_URL;
  });

  it('rejects non-POST methods', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'GET', headers: {} }, response as never);
    expect(state.statusCode).toBe(405);
  });

  it('responds 204 to OPTIONS', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'OPTIONS', headers: {} }, response as never);
    expect(state.statusCode).toBe(204);
  });

  it('rejects a malformed merchantTxnNo (400) without ever calling ICICI or the repository', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'not-a-valid-id!!' } }, response as never);
    expect(state.statusCode).toBe(400);
    expect(mockCheckIciciTransactionStatus).not.toHaveBeenCalled();
    expect(mockGetPublicStatusByMerchantTxnNo).not.toHaveBeenCalled();
  });

  it('returns 400 when merchantTxnNo is missing entirely', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: {} }, response as never);
    expect(state.statusCode).toBe(400);
  });

  it('returns 404 for an unknown transaction, never calling ICICI', async () => {
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValueOnce(null);
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'UNKNOWN000000000001' } }, response as never);
    expect(state.statusCode).toBe(404);
    expect(mockCheckIciciTransactionStatus).not.toHaveBeenCalled();
  });

  it('never re-queries or downgrades a transaction already locally SUCCESS', async () => {
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValueOnce(LOCAL_SUCCESS);
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    expect(mockCheckIciciTransactionStatus).not.toHaveBeenCalled();
    expect(mockRecordCallback).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(200);
    expect((state.jsonBody as { transaction: { status: string } }).transaction.status).toBe('SUCCESS');
  });

  it('on a VERIFIED SUC response, persists SUCCESS and returns the refreshed status', async () => {
    mockCheckIciciTransactionStatus.mockResolvedValueOnce({
      outcome: 'VERIFIED',
      status: 'SUCCESS',
      merchantTxnNo: 'PZ123ABC',
      txnResponseCode: '0000',
      txnID: 'T-999',
    });
    mockGetPublicStatusByMerchantTxnNo
      .mockResolvedValueOnce(LOCAL_PENDING) // initial lookup
      .mockResolvedValueOnce({ ...LOCAL_PENDING, status: 'SUCCESS' }); // post-persist re-read

    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    expect(mockCheckIciciTransactionStatus).toHaveBeenCalledWith('PZ123ABC', 'PZ123ABC', expect.any(Object));
    expect(mockRecordCallback).toHaveBeenCalledWith(
      expect.objectContaining({ merchantTxnNo: 'PZ123ABC', status: 'SUCCESS', providerTransactionId: 'T-999' }),
    );
    expect(state.statusCode).toBe(200);
    expect((state.jsonBody as { reconciled: boolean }).reconciled).toBe(true);
    expect((state.jsonBody as { transaction: { status: string } }).transaction.status).toBe('SUCCESS');
  });

  it('never persists or trusts a hash-mismatched STATUS response', async () => {
    mockCheckIciciTransactionStatus.mockResolvedValueOnce({ outcome: 'REJECTED_HASH_MISMATCH', status: 'UNKNOWN' });
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    expect(mockRecordCallback).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(200);
    expect((state.jsonBody as { reconciled: boolean }).reconciled).toBe(false);
    expect((state.jsonBody as { transaction: { status: string } }).transaction.status).toBe('INITIATED');
  });

  it('never persists on a TIMEOUT outcome, leaves local status untouched', async () => {
    mockCheckIciciTransactionStatus.mockResolvedValueOnce({ outcome: 'TIMEOUT', status: 'UNKNOWN' });
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    expect(mockRecordCallback).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(200);
    expect((state.jsonBody as { reconciled: boolean }).reconciled).toBe(false);
  });

  it('never persists when the verified response merchantTxnNo does not match the request', async () => {
    mockCheckIciciTransactionStatus.mockResolvedValueOnce({
      outcome: 'VERIFIED',
      status: 'SUCCESS',
      merchantTxnNo: 'SOMEONE-ELSES-TXN',
      txnResponseCode: '0000',
    });
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    expect(mockRecordCallback).not.toHaveBeenCalled();
    expect((state.jsonBody as { reconciled: boolean }).reconciled).toBe(false);
  });

  it('maps a verified REJ response to FAILED and persists it', async () => {
    mockCheckIciciTransactionStatus.mockResolvedValueOnce({
      outcome: 'VERIFIED',
      status: 'FAILED',
      merchantTxnNo: 'PZ123ABC',
      txnResponseCode: '9999',
    });
    mockGetPublicStatusByMerchantTxnNo
      .mockResolvedValueOnce(LOCAL_PENDING)
      .mockResolvedValueOnce({ ...LOCAL_PENDING, status: 'FAILED' });

    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    expect((state.jsonBody as { transaction: { status: string } }).transaction.status).toBe('FAILED');
  });

  it('never exposes the hash key or any internal field in the response body', async () => {
    mockCheckIciciTransactionStatus.mockResolvedValueOnce({
      outcome: 'VERIFIED',
      status: 'SUCCESS',
      merchantTxnNo: 'PZ123ABC',
      txnResponseCode: '0000',
      txnID: 'T-999',
    });
    mockGetPublicStatusByMerchantTxnNo
      .mockResolvedValueOnce(LOCAL_PENDING)
      .mockResolvedValueOnce({ ...LOCAL_PENDING, status: 'SUCCESS' });

    const { response } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    const serialized = JSON.stringify(response.json.mock.calls[0][0]);
    expect(serialized).not.toContain('test-fixture-key-not-a-real-secret');
    expect(serialized).not.toMatch(/hashKey/i);
  });

  it('returns 503 without leaking config details when ICICI config is incomplete', async () => {
    delete process.env.ICICI_HASH_KEY;
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    expect(state.statusCode).toBe(503);
    expect(JSON.stringify(state.jsonBody)).not.toContain('ICICI_HASH_KEY');
    expect(mockCheckIciciTransactionStatus).not.toHaveBeenCalled();
  });
});
