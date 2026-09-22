import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildIciciDirectOrangeInitiateSaleHashInput,
  buildIciciHashV1Input,
  computeIciciHmacSha256Hex,
  generateIciciDirectOrangeInitiateSaleHash,
  generateIciciHashV1,
  ICICI_MERCHANT_TXN_NO_MAX_LENGTH,
  IciciHashInputError,
  type IciciDirectOrangeInitiateSaleFields,
} from './crypto';

const TEST_KEY = 'test-fixture-key-not-a-real-secret';

/**
 * Field values reconstructed from a documented Direct Orange PG worked
 * example (Hash Calculation V1 — ascending parameter-name order). The
 * documentation supplied the *concatenated* hash-input string and its
 * secureHash, not the individual field values — this breakdown was
 * derived by matching segments of the documented string against values
 * already confirmed for this integration (aggregatorID, merchantId,
 * currencyCode, payType, transactionType), and is verified below to
 * reproduce the documented string exactly, character for character.
 */
const DOCUMENTED_EXAMPLE_FIELDS: IciciDirectOrangeInitiateSaleFields = {
  addlParam1: 'ABCD',
  addlParam2: '111',
  aggregatorID: 'A100000000007164',
  amount: '100.00',
  currencyCode: '356',
  customerEmailID: 'narayan.kapase@phicommerce.com',
  customerMobileNo: '917709356362',
  customerName: 'Narayan',
  merchantId: '100000000007164',
  merchantTxnNo: '757585887575',
  payType: '0',
  returnURL: 'https://pgpayuat.icicibank.com/tsp/pg/api/merchant',
  transactionType: 'SALE',
  txnDate: '20241121115413',
};

const DOCUMENTED_EXAMPLE_HASH_INPUT =
  'ABCD111A100000000007164100.00356narayan.kapase@phicommerce.com917709356362Narayan' +
  '1000000000071647575858875750https://pgpayuat.icicibank.com/tsp/pg/api/merchantSALE20241121115413';

const DOCUMENTED_EXAMPLE_SECURE_HASH = '205a2c1e897d3d654bbc92858b1da4929d0e2b1bbcedb781723f6db22768a10b';

describe('buildIciciHashV1Input (generic ICICI Hash Calculation V1 primitive)', () => {
  it('concatenates VALUES in ascending order of PARAMETER NAME, no delimiter, no field names', () => {
    expect(
      buildIciciHashV1Input({
        zField: 'last',
        aField: 'first',
        mField: 'middle',
      }),
    ).toBe('firstmiddlelast');
  });

  it('excludes null, undefined, and empty-string parameters ("ignore only null/empty values")', () => {
    expect(
      buildIciciHashV1Input({
        keep1: 'A',
        dropNull: null,
        dropUndefined: undefined,
        dropEmpty: '',
        keep2: 'B',
      }),
    ).toBe('AB');
  });

  it('includes every parameter actually given, even ones not on any published field table (doc Note 1)', () => {
    // This module never filters to a known field set — it hashes exactly
    // the object it's handed, which is how an unpublished-but-present
    // parameter still participates, per the bank's documented rule.
    expect(buildIciciHashV1Input({ merchantId: 'M1', someUndocumentedField: 'X' })).toBe('M1X');
  });

  it('reproduces the documented worked example hash input exactly, via the Direct Orange wrapper', () => {
    expect(buildIciciDirectOrangeInitiateSaleHashInput(DOCUMENTED_EXAMPLE_FIELDS)).toBe(DOCUMENTED_EXAMPLE_HASH_INPUT);
  });
});

describe('buildIciciDirectOrangeInitiateSaleHashInput', () => {
  it('concatenates fields in ascending parameter-name order, no delimiter, no field names', () => {
    const fields: IciciDirectOrangeInitiateSaleFields = {
      addlParam1: 'A1',
      addlParam2: 'A2',
      aggregatorID: 'AGG',
      amount: '10.00',
      currencyCode: '356',
      customerEmailID: 'x@y.com',
      customerMobileNo: '9999999999',
      customerName: 'Test',
      merchantId: 'MERCH',
      merchantTxnNo: 'TXN1',
      payType: '0',
      returnURL: 'https://example.test/return',
      transactionType: 'SALE',
      txnDate: '20240101000000',
    };

    expect(buildIciciDirectOrangeInitiateSaleHashInput(fields)).toBe(
      'A1A2AGG10.00356x@y.com9999999999TestMERCHTXN10https://example.test/returnSALE20240101000000',
    );
  });

  it('excludes empty-string addlParam1/addlParam2 per the documented "ignore null/empty" rule', () => {
    const fields: IciciDirectOrangeInitiateSaleFields = {
      ...DOCUMENTED_EXAMPLE_FIELDS,
      addlParam1: '',
      addlParam2: '',
    };

    // Confirmed by the doc's Hash Calculation V1 rule: empty parameters
    // are excluded entirely from the concatenation (not replaced by
    // anything), so removing addlParam1/addlParam2 here removes their
    // characters from the front of the string too.
    expect(buildIciciDirectOrangeInitiateSaleHashInput(fields)).toBe(
      'A100000000007164100.00356narayan.kapase@phicommerce.com917709356362Narayan' +
        '1000000000071647575858875750https://pgpayuat.icicibank.com/tsp/pg/api/merchantSALE20241121115413',
    );
  });

  it('preserves the amount string exactly as given, including trailing zeros', () => {
    const fields: IciciDirectOrangeInitiateSaleFields = { ...DOCUMENTED_EXAMPLE_FIELDS, amount: '100.00' };
    expect(buildIciciDirectOrangeInitiateSaleHashInput(fields)).toContain('100.00356');

    // A differently formatted amount must flow through unchanged too —
    // this module must never reformat or round the amount.
    const altFields: IciciDirectOrangeInitiateSaleFields = { ...DOCUMENTED_EXAMPLE_FIELDS, amount: '2000.50' };
    expect(buildIciciDirectOrangeInitiateSaleHashInput(altFields)).toContain('2000.50356');
  });

  it('accepts a merchantTxnNo up to the 20-character bank limit', () => {
    const merchantTxnNo = 'A'.repeat(ICICI_MERCHANT_TXN_NO_MAX_LENGTH);
    const fields: IciciDirectOrangeInitiateSaleFields = { ...DOCUMENTED_EXAMPLE_FIELDS, merchantTxnNo };
    expect(() => buildIciciDirectOrangeInitiateSaleHashInput(fields)).not.toThrow();
    expect(buildIciciDirectOrangeInitiateSaleHashInput(fields)).toContain(merchantTxnNo);
  });

  it('rejects a merchantTxnNo longer than 20 characters (breaks bank QR generation)', () => {
    const merchantTxnNo = 'A'.repeat(ICICI_MERCHANT_TXN_NO_MAX_LENGTH + 1);
    const fields: IciciDirectOrangeInitiateSaleFields = { ...DOCUMENTED_EXAMPLE_FIELDS, merchantTxnNo };
    expect(() => buildIciciDirectOrangeInitiateSaleHashInput(fields)).toThrow(IciciHashInputError);
  });
});

describe('generateIciciDirectOrangeInitiateSaleHash / generateIciciHashV1', () => {
  // NOTE: the ICICI hash key used to produce the documented example's
  // secureHash was not supplied for this task (and must never be
  // hardcoded here even if it had been). Per policy ("if the sample
  // cannot be reproduced because the correct secret is unavailable, mark
  // the test as requiring bank credentials — never fake the expected
  // result"), full reproduction of DOCUMENTED_EXAMPLE_SECURE_HASH is
  // skipped rather than faked.
  it.skip('reproduces the documented Direct Orange PG example secureHash (requires the real bank hash key)', () => {
    const hashKey = 'REPLACE-WITH-ACTUAL-ICICI-UAT-HASH-KEY';
    expect(generateIciciDirectOrangeInitiateSaleHash(DOCUMENTED_EXAMPLE_FIELDS, hashKey)).toBe(
      DOCUMENTED_EXAMPLE_SECURE_HASH,
    );
  });

  it('produces a 64-character lowercase hex digest (matches the documented secureHash format)', () => {
    const hash = generateIciciDirectOrangeInitiateSaleHash(DOCUMENTED_EXAMPLE_FIELDS, TEST_KEY);
    expect(hash).toHaveLength(DOCUMENTED_EXAMPLE_SECURE_HASH.length);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateIciciDirectOrangeInitiateSaleHash matches calling the generic V1 primitive directly', () => {
    expect(generateIciciDirectOrangeInitiateSaleHash(DOCUMENTED_EXAMPLE_FIELDS, TEST_KEY)).toBe(
      generateIciciHashV1(DOCUMENTED_EXAMPLE_FIELDS as unknown as Record<string, string>, TEST_KEY),
    );
  });

  it('is deterministic: identical fields and key always produce the identical hash', () => {
    const first = generateIciciDirectOrangeInitiateSaleHash(DOCUMENTED_EXAMPLE_FIELDS, TEST_KEY);
    const second = generateIciciDirectOrangeInitiateSaleHash({ ...DOCUMENTED_EXAMPLE_FIELDS }, TEST_KEY);
    expect(first).toBe(second);
  });

  it('produces a different hash when any single field changes', () => {
    const baseline = generateIciciDirectOrangeInitiateSaleHash(DOCUMENTED_EXAMPLE_FIELDS, TEST_KEY);

    const changedAmount = generateIciciDirectOrangeInitiateSaleHash(
      { ...DOCUMENTED_EXAMPLE_FIELDS, amount: '100.01' },
      TEST_KEY,
    );
    const changedTxnNo = generateIciciDirectOrangeInitiateSaleHash(
      { ...DOCUMENTED_EXAMPLE_FIELDS, merchantTxnNo: 'DIFFERENT001' },
      TEST_KEY,
    );

    expect(changedAmount).not.toBe(baseline);
    expect(changedTxnNo).not.toBe(baseline);
    expect(changedAmount).not.toBe(changedTxnNo);
  });

  it('produces a different hash when the key changes but fields are identical', () => {
    const hashA = generateIciciDirectOrangeInitiateSaleHash(DOCUMENTED_EXAMPLE_FIELDS, 'key-a');
    const hashB = generateIciciDirectOrangeInitiateSaleHash(DOCUMENTED_EXAMPLE_FIELDS, 'key-b');
    expect(hashA).not.toBe(hashB);
  });

  it('rejects merchantTxnNo over 20 characters before ever computing a hash', () => {
    const fields: IciciDirectOrangeInitiateSaleFields = {
      ...DOCUMENTED_EXAMPLE_FIELDS,
      merchantTxnNo: 'A'.repeat(ICICI_MERCHANT_TXN_NO_MAX_LENGTH + 1),
    };
    expect(() => generateIciciDirectOrangeInitiateSaleHash(fields, TEST_KEY)).toThrow(IciciHashInputError);
  });
});

describe('computeIciciHmacSha256Hex (shared HMAC primitive)', () => {
  it('treats the key as UTF-8 bytes and the message as ASCII bytes (matches the bank Java reference exactly)', () => {
    const expected = createHmac('sha256', Buffer.from(TEST_KEY, 'utf8')).update('hello', 'ascii').digest('hex');
    expect(computeIciciHmacSha256Hex('hello', TEST_KEY)).toBe(expected);
  });

  it('differs from a UTF-8-message encoding for non-ASCII input (proves ASCII encoding is actually applied)', () => {
    const nonAsciiInput = 'café';
    const asAscii = createHmac('sha256', Buffer.from(TEST_KEY, 'utf8')).update(nonAsciiInput, 'ascii').digest('hex');
    const asUtf8 = createHmac('sha256', Buffer.from(TEST_KEY, 'utf8')).update(nonAsciiInput, 'utf8').digest('hex');

    expect(asAscii).not.toBe(asUtf8);
    expect(computeIciciHmacSha256Hex(nonAsciiInput, TEST_KEY)).toBe(asAscii);
  });

  it('outputs lowercase hexadecimal only', () => {
    const hash = computeIciciHmacSha256Hex('any-input', TEST_KEY);
    expect(hash).toBe(hash.toLowerCase());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
