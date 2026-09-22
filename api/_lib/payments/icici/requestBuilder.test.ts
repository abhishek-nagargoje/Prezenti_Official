import { describe, expect, it } from 'vitest';
import { generateIciciDirectOrangeInitiateSaleHash } from './crypto';
import { buildIciciInitiateSaleRequestBody, type IciciInitiateSaleTransactionInput } from './requestBuilder';

const CONFIG = {
  merchantId: '100000000007164',
  aggregatorId: 'A100000000007164',
  currencyCode: '356',
  payType: '0',
  transactionType: 'SALE',
  hashKey: 'test-fixture-key-not-a-real-secret',
};

const INPUT: IciciInitiateSaleTransactionInput = {
  merchantTxnNo: 'PZ123ABC',
  amount: '2.00',
  txnDate: '20241121115413',
  customerEmailID: 'customer@example.com',
  customerMobileNo: '919876543210',
  customerName: 'Test Customer',
  returnURL: 'https://prezenti.com/api/payments/icici/return',
};

describe('buildIciciInitiateSaleRequestBody', () => {
  it('includes every documented Direct Orange PG field plus secureHash', () => {
    const body = buildIciciInitiateSaleRequestBody(INPUT, CONFIG);

    expect(body).toMatchObject({
      merchantId: CONFIG.merchantId,
      aggregatorID: CONFIG.aggregatorId,
      merchantTxnNo: INPUT.merchantTxnNo,
      amount: INPUT.amount,
      currencyCode: CONFIG.currencyCode,
      payType: CONFIG.payType,
      customerEmailID: INPUT.customerEmailID,
      transactionType: CONFIG.transactionType,
      returnURL: INPUT.returnURL,
      txnDate: INPUT.txnDate,
      customerMobileNo: INPUT.customerMobileNo,
      customerName: INPUT.customerName,
      addlParam1: '',
      addlParam2: '',
    });
    expect(body.secureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never includes the hash key anywhere in the returned object', () => {
    const body = buildIciciInitiateSaleRequestBody(INPUT, CONFIG);
    expect(JSON.stringify(body)).not.toContain(CONFIG.hashKey);
  });

  it('computes a secureHash matching the crypto module directly for the same fields', () => {
    const body = buildIciciInitiateSaleRequestBody(INPUT, CONFIG);
    // secureHash itself must be excluded from what's hashed — passing the
    // full body (which already contains secureHash) would incorporate
    // that field into the computation and never match.
    const { secureHash: _secureHash, ...fieldsOnly } = body;
    void _secureHash;
    const expectedHash = generateIciciDirectOrangeInitiateSaleHash(fieldsOnly, CONFIG.hashKey);
    expect(body.secureHash).toBe(expectedHash);
  });

  it('produces a different secureHash when the amount changes', () => {
    const bodyA = buildIciciInitiateSaleRequestBody(INPUT, CONFIG);
    const bodyB = buildIciciInitiateSaleRequestBody({ ...INPUT, amount: '3.00' }, CONFIG);
    expect(bodyA.secureHash).not.toBe(bodyB.secureHash);
  });
});
