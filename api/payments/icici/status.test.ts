import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPublicStatusByMerchantTxnNo = vi.fn();

vi.mock('../../_lib/payments/icici/repository', () => ({
  createSupabaseClientFromEnv: () => ({}),
  createSupabasePaymentTransactionRepository: () => ({
    getPublicStatusByMerchantTxnNo: (...args: unknown[]) => mockGetPublicStatusByMerchantTxnNo(...args),
  }),
}));

const { default: handler } = await import('./status');

function createResponse() {
  const state = { statusCode: 0, jsonBody: undefined as unknown };
  const response = {
    setHeader: vi.fn(),
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      state.jsonBody = body;
    }),
    end: vi.fn(),
  };
  return { response, state };
}

const SAFE_TRANSACTION = {
  merchantTxnNo: 'PZ123ABC',
  status: 'SUCCESS' as const,
  amount: '2.00',
  currency: '356',
  responseDescription: 'Transaction successful',
  paymentMode: 'UPI',
  paymentDatetime: '2026-09-22T12:00:00+05:30',
};

describe('GET /api/payments/icici/status', () => {
  beforeEach(() => {
    mockGetPublicStatusByMerchantTxnNo.mockReset().mockResolvedValue(SAFE_TRANSACTION);
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

  it('rejects non-GET methods', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {} }, response as never);
    expect(state.statusCode).toBe(405);
  });

  it('rejects a missing merchantTxnNo', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'GET', headers: {}, query: {} }, response as never);
    expect(state.statusCode).toBe(400);
    expect(mockGetPublicStatusByMerchantTxnNo).not.toHaveBeenCalled();
  });

  it('rejects a malformed merchantTxnNo before ever querying the database', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'GET', headers: {}, query: { merchantTxnNo: '<script>alert(1)</script>' } }, response as never);
    expect(state.statusCode).toBe(400);
    expect(mockGetPublicStatusByMerchantTxnNo).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown transaction', async () => {
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValueOnce(null);
    const { response, state } = createResponse();
    await handler({ method: 'GET', headers: {}, query: { merchantTxnNo: 'UNKNOWN000000000001' } }, response as never);
    expect(state.statusCode).toBe(404);
  });

  it('returns a safe, normalized response for a known transaction', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'GET', headers: {}, query: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    expect(state.statusCode).toBe(200);
    const body = state.jsonBody as { success: boolean; transaction: typeof SAFE_TRANSACTION };
    expect(body.success).toBe(true);
    expect(body.transaction).toEqual(SAFE_TRANSACTION);
  });

  it('only ever returns the exact allow-listed field set — never any extra field, even if the repository resolves one', async () => {
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValueOnce({
      ...SAFE_TRANSACTION,
      // Simulates a hypothetical future repository leak: this route must
      // still only ever expose exactly the 7 fields it explicitly allow-lists,
      // as a second, independent layer on top of the repository's own
      // SQL select().
      internalId: 'uuid-should-never-be-returned',
      secureHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    } as never);
    const { response } = createResponse();
    await handler({ method: 'GET', headers: {}, query: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    const body = response.json.mock.calls[0][0] as { transaction: Record<string, unknown> };
    expect(Object.keys(body.transaction).sort()).toEqual(
      ['amount', 'currency', 'merchantTxnNo', 'paymentDatetime', 'paymentMode', 'responseDescription', 'status'].sort(),
    );
    expect(body.transaction).not.toHaveProperty('internalId');
    expect(body.transaction).not.toHaveProperty('secureHash');
  });

  it('never returns the hash key or secureHash, regardless of what the repository resolves', async () => {
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValueOnce({
      ...SAFE_TRANSACTION,
      secureHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    const { response } = createResponse();
    await handler({ method: 'GET', headers: {}, query: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    const serialized = JSON.stringify(response.json.mock.calls[0][0]);
    expect(serialized).not.toMatch(/hashKey/i);
    expect(serialized).not.toContain('test-fixture-key-not-a-real-secret');
  });

  it('returns 503 without leaking config details when ICICI config is incomplete', async () => {
    delete process.env.ICICI_HASH_KEY;
    const { response, state } = createResponse();
    await handler({ method: 'GET', headers: {}, query: { merchantTxnNo: 'PZ123ABC' } }, response as never);

    expect(state.statusCode).toBe(503);
    expect(JSON.stringify(state.jsonBody)).not.toContain('ICICI_HASH_KEY');
  });
});
