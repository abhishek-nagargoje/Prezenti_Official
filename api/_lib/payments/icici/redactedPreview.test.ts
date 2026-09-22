import { describe, expect, it } from 'vitest';
import { buildIciciInitiateSaleRequestBody } from './requestBuilder';
import { buildIciciInitiateSalePreview } from './redactedPreview';

const HASH_KEY = 'super-secret-key-value-must-never-appear';

const CONFIG = {
  merchantId: '100000000007164',
  aggregatorId: 'A100000000007164',
  currencyCode: '356',
  payType: '0',
  transactionType: 'SALE',
  hashKey: HASH_KEY,
};

const requestBody = buildIciciInitiateSaleRequestBody(
  {
    merchantTxnNo: 'PZ123ABC',
    amount: '2.00',
    txnDate: '20241121115413',
    customerEmailID: 'customer@example.com',
    customerMobileNo: '919876543210',
    customerName: 'Test Customer',
    returnURL: 'https://prezenti.com/api/payments/icici/return',
  },
  CONFIG,
);

describe('buildIciciInitiateSalePreview', () => {
  const preview = buildIciciInitiateSalePreview(
    requestBody,
    'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale',
  );

  it('never includes the hash key anywhere in the serialized preview', () => {
    expect(JSON.stringify(preview)).not.toContain(HASH_KEY);
  });

  it('explicitly confirms the hash key was not included', () => {
    expect(preview.hashKeyIncluded).toBe(false);
  });

  it('redacts customer email, mobile, and name from the hash-input preview', () => {
    expect(preview.redactedHashInputPreview).not.toContain('customer@example.com');
    expect(preview.redactedHashInputPreview).not.toContain('919876543210');
    expect(preview.redactedHashInputPreview).not.toContain('Test Customer');
  });

  it('includes the endpoint, method, content type, and non-sensitive transaction fields', () => {
    expect(preview.endpoint).toBe('https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale');
    expect(preview.httpMethod).toBe('POST');
    expect(preview.contentType).toBe('application/json');
    expect(preview.amount).toBe('2.00');
    expect(preview.currencyCode).toBe('356');
    expect(preview.merchantTxnNo).toBe('PZ123ABC');
    expect(preview.txnDate).toBe('20241121115413');
    expect(preview.returnURL).toBe('https://prezenti.com/api/payments/icici/return');
    expect(preview.secureHash).toBe(requestBody.secureHash);
  });

  it('lists every request field name', () => {
    expect(preview.requestFieldNames).toEqual(Object.keys(requestBody));
  });
});
