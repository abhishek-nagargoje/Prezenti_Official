import { describe, expect, it } from 'vitest';
import {
  ICICI_INITIATE_SALE_SUCCESS_CODE,
  validateIciciInitiateSaleResponse,
  type IciciInitiateSaleExpected,
} from './initiateSaleResponse';

const EXPECTED: IciciInitiateSaleExpected = {
  merchantId: '100000000007164',
  aggregatorID: 'A100000000007164',
  merchantTxnNo: 'PZ123ABC',
};

describe('validateIciciInitiateSaleResponse', () => {
  it('accepts a well-formed R1000 response with matching identifiers and required redirect fields', () => {
    const result = validateIciciInitiateSaleResponse(
      {
        responseCode: ICICI_INITIATE_SALE_SUCCESS_CODE,
        merchantId: EXPECTED.merchantId,
        aggregatorID: EXPECTED.aggregatorID,
        merchantTxnNo: EXPECTED.merchantTxnNo,
        redirectURI: 'https://pgpayuat.icicibank.com/tsp/pg/somepage',
        tranCtx: 'abc123tranctx',
      },
      EXPECTED,
    );

    expect(result.initiationAccepted).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.redirectURI).toBe('https://pgpayuat.icicibank.com/tsp/pg/somepage');
    expect(result.tranCtx).toBe('abc123tranctx');
  });

  it('does NOT treat R1000 as final payment success — it only signals accepted initiation', () => {
    const result = validateIciciInitiateSaleResponse(
      {
        responseCode: ICICI_INITIATE_SALE_SUCCESS_CODE,
        merchantId: EXPECTED.merchantId,
        aggregatorID: EXPECTED.aggregatorID,
        merchantTxnNo: EXPECTED.merchantTxnNo,
        redirectURI: 'https://pgpayuat.icicibank.com/tsp/pg/somepage',
        tranCtx: 'abc123tranctx',
      },
      EXPECTED,
    );

    // The result type itself only ever asserts "initiationAccepted" — there
    // is no "paymentSuccess" field this could be mistaken for.
    expect(Object.keys(result)).not.toContain('paymentSuccess');
    expect(Object.keys(result)).not.toContain('success');
  });

  it('rejects a non-R1000 response code without requiring redirectURI/tranCtx', () => {
    const result = validateIciciInitiateSaleResponse(
      { responseCode: 'R1001', merchantId: EXPECTED.merchantId, aggregatorID: EXPECTED.aggregatorID, merchantTxnNo: EXPECTED.merchantTxnNo },
      EXPECTED,
    );

    expect(result.initiationAccepted).toBe(false);
  });

  it('rejects R1000 missing redirectURI', () => {
    const result = validateIciciInitiateSaleResponse(
      {
        responseCode: ICICI_INITIATE_SALE_SUCCESS_CODE,
        merchantId: EXPECTED.merchantId,
        aggregatorID: EXPECTED.aggregatorID,
        merchantTxnNo: EXPECTED.merchantTxnNo,
        tranCtx: 'abc123tranctx',
      },
      EXPECTED,
    );

    expect(result.initiationAccepted).toBe(false);
    expect(result.errors.some((e) => e.field === 'redirectURI')).toBe(true);
  });

  it('rejects R1000 missing tranCtx', () => {
    const result = validateIciciInitiateSaleResponse(
      {
        responseCode: ICICI_INITIATE_SALE_SUCCESS_CODE,
        merchantId: EXPECTED.merchantId,
        aggregatorID: EXPECTED.aggregatorID,
        merchantTxnNo: EXPECTED.merchantTxnNo,
        redirectURI: 'https://pgpayuat.icicibank.com/tsp/pg/somepage',
      },
      EXPECTED,
    );

    expect(result.initiationAccepted).toBe(false);
    expect(result.errors.some((e) => e.field === 'tranCtx')).toBe(true);
  });

  it('rejects a response whose merchantId does not match what was sent', () => {
    const result = validateIciciInitiateSaleResponse(
      {
        responseCode: ICICI_INITIATE_SALE_SUCCESS_CODE,
        merchantId: 'someone-elses-merchant-id',
        aggregatorID: EXPECTED.aggregatorID,
        merchantTxnNo: EXPECTED.merchantTxnNo,
        redirectURI: 'https://pgpayuat.icicibank.com/tsp/pg/somepage',
        tranCtx: 'abc123tranctx',
      },
      EXPECTED,
    );

    expect(result.initiationAccepted).toBe(false);
    expect(result.errors.some((e) => e.field === 'merchantId')).toBe(true);
  });

  it('rejects a response whose merchantTxnNo does not match what was sent', () => {
    const result = validateIciciInitiateSaleResponse(
      {
        responseCode: ICICI_INITIATE_SALE_SUCCESS_CODE,
        merchantId: EXPECTED.merchantId,
        aggregatorID: EXPECTED.aggregatorID,
        merchantTxnNo: 'DIFFERENT-TXN-NO',
        redirectURI: 'https://pgpayuat.icicibank.com/tsp/pg/somepage',
        tranCtx: 'abc123tranctx',
      },
      EXPECTED,
    );

    expect(result.initiationAccepted).toBe(false);
    expect(result.errors.some((e) => e.field === 'merchantTxnNo')).toBe(true);
  });

  it('rejects a completely empty response', () => {
    const result = validateIciciInitiateSaleResponse({}, EXPECTED);
    expect(result.initiationAccepted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
