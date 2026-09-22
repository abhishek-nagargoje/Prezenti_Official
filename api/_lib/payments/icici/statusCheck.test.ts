import { describe, expect, it, vi } from 'vitest';
import { generateIciciHashV1 } from './crypto';
import {
  buildIciciStatusRequestBody,
  checkIciciTransactionStatus,
  generateIciciStatusHash,
  verifyIciciStatusResponseHash,
  type IciciStatusCheckRequestFields,
} from './statusCheck';

const TEST_KEY = 'test-fixture-key-not-a-real-secret';

// Field set matching the documented worked curl sample (Chapter 12,
// "Sample Transaction Status Check Request") — merchantId, merchantTxnNo,
// originalTxnNo, transactionType, addlParam1 (present in the sample even
// though it's not on the published field table, confirming Note 1).
const REQUEST_FIELDS: IciciStatusCheckRequestFields = {
  merchantId: 'T_S00067',
  merchantTxnNo: 'Test03102025',
  originalTxnNo: '7700206371536',
  transactionType: 'STATUS',
  addlParam1: 'Additional Information',
};

describe('generateIciciStatusHash', () => {
  it('uses the same ICICI Hash Calculation V1 primitive as Initiate Sale/callback (ascending param-name order)', () => {
    const hash = generateIciciStatusHash(REQUEST_FIELDS, TEST_KEY);
    const expected = generateIciciHashV1(REQUEST_FIELDS as unknown as Record<string, string>, TEST_KEY);
    expect(hash).toBe(expected);
  });

  it('produces a 64-character lowercase hex digest', () => {
    const hash = generateIciciStatusHash(REQUEST_FIELDS, TEST_KEY);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const a = generateIciciStatusHash(REQUEST_FIELDS, TEST_KEY);
    const b = generateIciciStatusHash({ ...REQUEST_FIELDS }, TEST_KEY);
    expect(a).toBe(b);
  });

  it('produces a different hash when originalTxnNo changes', () => {
    const baseline = generateIciciStatusHash(REQUEST_FIELDS, TEST_KEY);
    const changed = generateIciciStatusHash({ ...REQUEST_FIELDS, originalTxnNo: 'DIFFERENT' }, TEST_KEY);
    expect(changed).not.toBe(baseline);
  });

  it('produces a different hash when addlParam1 (undocumented-but-present field) changes', () => {
    // Confirms Note 1's practical effect: this optional field genuinely
    // participates in the hash, exactly as the Direct Orange Initiate
    // Sale and Payment Response hashes do for their own extra fields.
    const baseline = generateIciciStatusHash(REQUEST_FIELDS, TEST_KEY);
    const changed = generateIciciStatusHash({ ...REQUEST_FIELDS, addlParam1: 'Something Else' }, TEST_KEY);
    expect(changed).not.toBe(baseline);
  });

  it('excludes addlParam1 from the hash entirely when absent (not padded/defaulted)', () => {
    const { addlParam1: _drop, ...withoutOptional } = REQUEST_FIELDS;
    void _drop;
    const withoutHash = generateIciciStatusHash(withoutOptional as IciciStatusCheckRequestFields, TEST_KEY);
    const expected = generateIciciHashV1(withoutOptional as unknown as Record<string, string>, TEST_KEY);
    expect(withoutHash).toBe(expected);
  });
});

describe('verifyIciciStatusResponseHash', () => {
  const RAW_RESPONSE: Record<string, string> = {
    txnRespDescription: 'Transaction successful',
    amount: '550.00',
    txnResponseCode: '0000',
    txnAuthID: '811069696857',
    respDescription: 'Request processed successfully',
    paymentMode: 'UPI',
    responseCode: '000',
    txnStatus: 'SUC',
    merchantId: 'T_S00067',
    merchantTxnNo: '7700206371536',
    paymentDateTime: '20251003155335',
    txnID: '7700206371536',
  };

  it('accepts a correctly-hashed STATUS response', () => {
    const withHash = { ...RAW_RESPONSE, secureHash: generateIciciHashV1(RAW_RESPONSE, TEST_KEY) };
    expect(verifyIciciStatusResponseHash(withHash, TEST_KEY)).toBe(true);
  });

  it('rejects a tampered STATUS response (e.g. txnStatus flipped after hashing)', () => {
    const withHash = { ...RAW_RESPONSE, secureHash: generateIciciHashV1(RAW_RESPONSE, TEST_KEY) };
    const tampered = { ...withHash, txnStatus: 'SUC', amount: '999999.00' };
    expect(verifyIciciStatusResponseHash(tampered, TEST_KEY)).toBe(false);
  });

  it('rejects when secureHash is missing', () => {
    expect(verifyIciciStatusResponseHash(RAW_RESPONSE, TEST_KEY)).toBe(false);
  });
});

describe('buildIciciStatusRequestBody', () => {
  it('includes every request field plus a matching secureHash, never the hash key', () => {
    const body = buildIciciStatusRequestBody(REQUEST_FIELDS, TEST_KEY);

    expect(body).toMatchObject({
      merchantId: REQUEST_FIELDS.merchantId,
      merchantTxnNo: REQUEST_FIELDS.merchantTxnNo,
      originalTxnNo: REQUEST_FIELDS.originalTxnNo,
      transactionType: 'STATUS',
      addlParam1: REQUEST_FIELDS.addlParam1,
    });
    expect(body.secureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
  });

  it('the returned secureHash matches generateIciciStatusHash for the same fields', () => {
    const body = buildIciciStatusRequestBody(REQUEST_FIELDS, TEST_KEY);
    expect(body.secureHash).toBe(generateIciciStatusHash(REQUEST_FIELDS, TEST_KEY));
  });
});

const CONFIG = {
  environment: 'uat' as const,
  merchantId: '100000000007164',
  aggregatorId: 'A100000000007164',
  hashKey: TEST_KEY,
  commandUrl: 'https://pgpayuat.icicibank.com/tsp/pg/api/command',
};

function jsonFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ status, text: async () => JSON.stringify(body) });
}

describe('checkIciciTransactionStatus', () => {
  it('reaches a VERIFIED/SUCCESS outcome for a correctly-hashed txnStatus=SUC response', async () => {
    const responseFields = {
      txnStatus: 'SUC',
      txnResponseCode: '0000',
      merchantTxnNo: 'PZ123ABC',
      txnID: 'T1472640294491',
    };
    const fetchImpl = jsonFetch(200, { ...responseFields, secureHash: generateIciciHashV1(responseFields, TEST_KEY) });

    const result = await checkIciciTransactionStatus('PZ123ABC', 'PZ123ABC', CONFIG, fetchImpl);

    expect(result.outcome).toBe('VERIFIED');
    expect(result.status).toBe('SUCCESS');
    expect(result.txnID).toBe('T1472640294491');
  });

  it('never reaches SUCCESS when the response secureHash does not verify', async () => {
    const responseFields = { txnStatus: 'SUC', txnResponseCode: '0000', merchantTxnNo: 'PZ123ABC' };
    // Hash computed under a different key.
    const fetchImpl = jsonFetch(200, { ...responseFields, secureHash: generateIciciHashV1(responseFields, 'wrong-key') });

    const result = await checkIciciTransactionStatus('PZ123ABC', 'PZ123ABC', CONFIG, fetchImpl);

    expect(result.outcome).toBe('REJECTED_HASH_MISMATCH');
    expect(result.status).toBe('UNKNOWN');
    expect(result.status).not.toBe('SUCCESS');
  });

  it('maps a verified txnStatus=REJ response to FAILED', async () => {
    const responseFields = { txnStatus: 'REJ', txnResponseCode: '9999', merchantTxnNo: 'PZ123ABC' };
    const fetchImpl = jsonFetch(200, { ...responseFields, secureHash: generateIciciHashV1(responseFields, TEST_KEY) });

    const result = await checkIciciTransactionStatus('PZ123ABC', 'PZ123ABC', CONFIG, fetchImpl);

    expect(result.outcome).toBe('VERIFIED');
    expect(result.status).toBe('FAILED');
  });

  it('reports REJECTED_HTTP_ERROR for a non-2xx response, never SUCCESS', async () => {
    const fetchImpl = jsonFetch(500, { error: 'internal error' });
    const result = await checkIciciTransactionStatus('PZ123ABC', 'PZ123ABC', CONFIG, fetchImpl);

    expect(result.outcome).toBe('REJECTED_HTTP_ERROR');
    expect(result.status).toBe('UNKNOWN');
  });

  it('reports REJECTED_MALFORMED_RESPONSE for a non-JSON body, never SUCCESS', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, text: async () => '<html>not json</html>' });
    const result = await checkIciciTransactionStatus('PZ123ABC', 'PZ123ABC', CONFIG, fetchImpl);

    expect(result.outcome).toBe('REJECTED_MALFORMED_RESPONSE');
    expect(result.status).toBe('UNKNOWN');
  });

  it('reports TIMEOUT (never a silent retry) when the request aborts', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    const result = await checkIciciTransactionStatus('PZ123ABC', 'PZ123ABC', CONFIG, fetchImpl);

    expect(result.outcome).toBe('TIMEOUT');
    expect(result.status).toBe('UNKNOWN');
  });

  it('never calls a production Command endpoint', async () => {
    const fetchImpl = vi.fn();
    const prodConfig = { ...CONFIG, commandUrl: 'https://pgpay.icicibank.com/pg/api/command' };

    await expect(checkIciciTransactionStatus('PZ123ABC', 'PZ123ABC', prodConfig, fetchImpl)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
