import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateIciciHashV1 } from '../../_lib/payments/icici/crypto';

const mockRecordCallback = vi.fn().mockResolvedValue(undefined);
const mockGetPublicStatusByMerchantTxnNo = vi.fn();
const mockCreateSupabaseClientFromEnv = vi.fn().mockReturnValue({});
const mockCreateRepo = vi.fn().mockReturnValue({
  recordCallback: mockRecordCallback,
  getPublicStatusByMerchantTxnNo: mockGetPublicStatusByMerchantTxnNo,
});

vi.mock('../../_lib/payments/icici/repository', () => ({
  createSupabaseClientFromEnv: () => mockCreateSupabaseClientFromEnv(),
  createSupabasePaymentTransactionRepository: () => mockCreateRepo(),
}));

// Imported after the mock so the mocked module is what the handler under test resolves.
const { default: handler } = await import('./return');

function createResponse() {
  const headers: Record<string, string> = {};
  const state = { statusCode: 0, jsonBody: undefined as unknown, ended: false };
  const response = {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
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
  return { response, headers, state };
}

const TEST_HASH_KEY = 'test-fixture-key-not-a-real-secret';

function bodyWithValidHash(fields: Record<string, string>): Record<string, string> {
  return { ...fields, secureHash: generateIciciHashV1(fields, TEST_HASH_KEY) };
}

const VALID_FIELDS = {
  merchantTxnNo: 'PZ123ABC',
  responseCode: '0000',
  respDescription: 'SUCCESS',
  merchantId: '100000000007164',
  amount: '2.00',
};

/** A local transaction record matching VALID_FIELDS exactly — the "happy path" default. */
const MATCHING_LOCAL_TRANSACTION = {
  merchantTxnNo: 'PZ123ABC',
  status: 'INITIATED' as const,
  amount: '2.00',
  currency: '356',
};

describe('POST /api/payments/icici/return', () => {
  beforeEach(() => {
    mockRecordCallback.mockClear();
    mockGetPublicStatusByMerchantTxnNo.mockReset();
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValue(MATCHING_LOCAL_TRANSACTION);
    process.env.ICICI_MERCHANT_ID = '100000000007164';
    process.env.ICICI_AGGREGATOR_ID = 'A100000000007164';
    process.env.ICICI_HASH_KEY = TEST_HASH_KEY;
    process.env.ICICI_RETURN_URL = 'https://prezenti.com/api/payments/icici/return';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ICICI_MERCHANT_ID;
    delete process.env.ICICI_AGGREGATOR_ID;
    delete process.env.ICICI_HASH_KEY;
    delete process.env.ICICI_RETURN_URL;
  });

  it('rejects non-POST methods, including GET — the documented return mechanism is POST-only', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'GET', headers: {} }, response as never);
    expect(state.statusCode).toBe(405);
  });

  it('rejects DELETE and other methods', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'DELETE', headers: {} }, response as never);
    expect(state.statusCode).toBe(405);
  });

  it('accepts a correctly-hashed POST body matching the local transaction and reaches a trusted SUCCESS status', async () => {
    const { response, headers } = createResponse();
    const body = bodyWithValidHash(VALID_FIELDS);

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(headers.Location).toBe('/payment/result?merchantTxnNo=PZ123ABC');
    expect(mockRecordCallback).toHaveBeenCalledWith(
      expect.objectContaining({ merchantTxnNo: 'PZ123ABC', status: 'SUCCESS' }),
    );
  });

  it('never marks a callback SUCCESS when secureHash does not verify (tampered field)', async () => {
    const { response } = createResponse();
    const body = { ...bodyWithValidHash(VALID_FIELDS), respDescription: 'TAMPERED' };

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(
      expect.objectContaining({ merchantTxnNo: 'PZ123ABC', status: 'UNKNOWN' }),
    );
  });

  it('never treats responseCode 0000 as proof of success without a matching secureHash', async () => {
    const { response } = createResponse();
    // Correct fields, but a secureHash computed under a different key —
    // simulates an attacker who knows the response shape but not the key.
    const body = { ...VALID_FIELDS, secureHash: generateIciciHashV1(VALID_FIELDS, 'wrong-key') };

    await handler({ method: 'POST', headers: {}, body }, response as never);

    const call = mockRecordCallback.mock.calls[0][0];
    expect(call.status).not.toBe('SUCCESS');
    expect(call.status).toBe('UNKNOWN');
  });

  it('rejects (UNKNOWN) a hash-VALID callback when no local transaction exists for that merchantTxnNo', async () => {
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValueOnce(null);
    const { response } = createResponse();
    const body = bodyWithValidHash(VALID_FIELDS);

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'UNKNOWN' }));
  });

  it('rejects (UNKNOWN) a hash-VALID callback whose amount does not match the locally initiated amount', async () => {
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValueOnce({ ...MATCHING_LOCAL_TRANSACTION, amount: '999.00' });
    const { response } = createResponse();
    const body = bodyWithValidHash(VALID_FIELDS); // amount: '2.00'

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'UNKNOWN' }));
  });

  it('rejects (UNKNOWN) a hash-VALID callback whose merchantId does not match our configured merchant ID', async () => {
    const { response } = createResponse();
    const body = bodyWithValidHash({ ...VALID_FIELDS, merchantId: 'someone-elses-merchant-id' });

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'UNKNOWN' }));
  });

  it('rejects (UNKNOWN) a hash-VALID callback whose aggregatorID does not match our configured aggregator ID', async () => {
    const { response } = createResponse();
    const body = bodyWithValidHash({ ...VALID_FIELDS, aggregatorID: 'someone-elses-aggregator-id' });

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'UNKNOWN' }));
  });

  it('never marks SUCCESS or attempts hash verification when secureHash itself is missing entirely', async () => {
    const { response } = createResponse();
    const { secureHash: _drop, ...withoutHash } = bodyWithValidHash(VALID_FIELDS);
    void _drop;

    await handler({ method: 'POST', headers: {}, body: withoutHash }, response as never);

    // Rejected by shape validation before hash verification is even
    // attempted — recordCallback (and therefore any status, including
    // SUCCESS) is never reached.
    expect(mockRecordCallback).not.toHaveBeenCalled();
  });

  it('maps a verified non-success responseCode to FAILED, never SUCCESS', async () => {
    const { response } = createResponse();
    const body = bodyWithValidHash({ ...VALID_FIELDS, responseCode: '9999' });

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });

  it('maps a verified R1000 (out-of-band, e.g. UPI) responseCode to PENDING, never SUCCESS', async () => {
    const { response } = createResponse();
    const body = bodyWithValidHash({ ...VALID_FIELDS, responseCode: 'R1000' });

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING' }));
  });

  it('never downgrades an already-SUCCESS local transaction, even if a later hash-valid callback reports failure (stale-callback protection)', async () => {
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValueOnce({ ...MATCHING_LOCAL_TRANSACTION, status: 'SUCCESS' });
    const { response } = createResponse();
    const body = bodyWithValidHash({ ...VALID_FIELDS, responseCode: '9999' }); // a stale/replayed failure

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
  });

  it('never downgrades an already-SUCCESS local transaction even when the callback fails hash verification entirely (forged/corrupted request protection)', async () => {
    // This is the more dangerous case than the one above: an attacker or a
    // corrupted-in-transit request that never verifies at all, but still
    // happens to carry a real merchantTxnNo. The secureHash check alone
    // cannot protect against this — the never-downgrade-SUCCESS guard must
    // run for every outcome, not just the hash-VERIFIED branch.
    mockGetPublicStatusByMerchantTxnNo.mockResolvedValueOnce({ ...MATCHING_LOCAL_TRANSACTION, status: 'SUCCESS' });
    const { response } = createResponse();
    const body = { ...bodyWithValidHash(VALID_FIELDS), respDescription: 'TAMPERED-AFTER-HASHING' };

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
  });

  it('records the callback idempotently (an UPDATE via recordCallback, never an insert path) on repeated identical callbacks', async () => {
    const { response } = createResponse();
    const body = bodyWithValidHash(VALID_FIELDS);

    await handler({ method: 'POST', headers: {}, body }, response as never);
    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledTimes(2);
    expect(mockRecordCallback.mock.calls[0][0]).toEqual(mockRecordCallback.mock.calls[1][0]);
  });

  it('persists providerTransactionId/providerPaymentId/paymentDateTime from the verified callback', async () => {
    const { response } = createResponse();
    const body = bodyWithValidHash({
      ...VALID_FIELDS,
      txnID: 'T1472640294491',
      paymentID: '006503',
      paymentDateTime: '20241121115413',
      paymentMode: 'UPI',
    });

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(mockRecordCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        providerTransactionId: 'T1472640294491',
        providerPaymentId: '006503',
        paymentDatetime: '2024-11-21T11:54:13+05:30',
        paymentMode: 'UPI',
      }),
    );
  });

  it('never uses query-string values for hashing — a query-only field cannot substitute for the POST body', async () => {
    const { response } = createResponse();
    // No `query` support exists on this route at all anymore, but this
    // test documents the contract explicitly: passing extra unrelated
    // properties on the request object (simulating a query string) must
    // have no effect, since only `request.body` is ever read.
    const body = bodyWithValidHash(VALID_FIELDS);

    await handler(
      { method: 'POST', headers: {}, body, query: { responseCode: '9999' } } as never,
      response as never,
    );

    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
  });

  it('redirects to a fixed internal path only — never a bank- or browser-supplied redirect target', async () => {
    const { response, headers } = createResponse();
    const body = bodyWithValidHash({ ...VALID_FIELDS, redirectURI: 'https://evil.example.com/steal' });

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(headers.Location).not.toContain('evil.example.com');
    expect(headers.Location?.startsWith('/payment/result')).toBe(true);
  });

  it('handles a malformed/incomplete payload by redirecting to the result page without a reference, without attempting hash verification', async () => {
    const { response, headers, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: {} }, response as never);

    expect(state.statusCode).toBe(302);
    expect(headers.Location).toBe('/payment/result');
    expect(mockRecordCallback).not.toHaveBeenCalled();
  });

  it('rejects a merchantTxnNo containing unsafe characters from ever reaching the redirect', async () => {
    const { response, headers } = createResponse();
    const body = bodyWithValidHash({ ...VALID_FIELDS, merchantTxnNo: '<script>alert(1)</script>' });

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(headers.Location).toBe('/payment/result');
  });

  it('still processes and redirects (staying UNKNOWN) when ICICI_HASH_KEY is unset', async () => {
    delete process.env.ICICI_HASH_KEY;
    const { response, state } = createResponse();
    const body = bodyWithValidHash(VALID_FIELDS);

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(state.statusCode).toBe(302);
    expect(mockRecordCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'UNKNOWN' }));
  });

  it('does not crash the request if persistence fails, and still redirects', async () => {
    mockRecordCallback.mockRejectedValueOnce(new Error('db unreachable'));
    const { response, state } = createResponse();
    const body = bodyWithValidHash(VALID_FIELDS);

    await handler({ method: 'POST', headers: {}, body }, response as never);

    expect(state.statusCode).toBe(302);
  });
});
