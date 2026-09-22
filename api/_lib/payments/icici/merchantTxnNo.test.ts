import { describe, expect, it } from 'vitest';
import { ICICI_MERCHANT_TXN_NO_MAX_LENGTH } from './crypto';
import { generateIciciMerchantTxnNo } from './merchantTxnNo';

describe('generateIciciMerchantTxnNo', () => {
  it('is never longer than the 20-character bank limit', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateIciciMerchantTxnNo().length).toBeLessThanOrEqual(ICICI_MERCHANT_TXN_NO_MAX_LENGTH);
    }
  });

  it('generates unique values across many calls', () => {
    const values = new Set(Array.from({ length: 500 }, () => generateIciciMerchantTxnNo()));
    expect(values.size).toBe(500);
  });

  it('is collision-resistant even when called with the same timestamp', () => {
    const fixedNow = 1_732_000_000_000;
    const values = new Set(Array.from({ length: 200 }, () => generateIciciMerchantTxnNo(fixedNow)));
    expect(values.size).toBe(200);
  });

  it('only contains uppercase alphanumeric characters', () => {
    expect(generateIciciMerchantTxnNo()).toMatch(/^[A-Z0-9]+$/);
  });
});
