import { describe, expect, it } from 'vitest';
import {
  ICICI_INITIATED_OUT_OF_BAND_CODE,
  mapIciciPaymentResponseCode,
  mapIciciTxnStatusToInternalStatus,
} from './responseCodes';

describe('mapIciciPaymentResponseCode (confirmed doc rule: 000/0000=success, R1000=initiated, else=failure)', () => {
  it.each([
    ['000', 'SUCCESS'],
    ['0000', 'SUCCESS'],
  ] as const)('maps responseCode %s to %s', (code, expected) => {
    expect(mapIciciPaymentResponseCode(code)).toBe(expected);
  });

  it('maps R1000 to PENDING, never SUCCESS (initiated/out-of-band only, not a completed payment)', () => {
    expect(mapIciciPaymentResponseCode(ICICI_INITIATED_OUT_OF_BAND_CODE)).toBe('PENDING');
    expect(mapIciciPaymentResponseCode('R1000')).not.toBe('SUCCESS');
  });

  it('maps any other value to FAILED, never SUCCESS', () => {
    expect(mapIciciPaymentResponseCode('R1001')).toBe('FAILED');
    expect(mapIciciPaymentResponseCode('999')).toBe('FAILED');
    expect(mapIciciPaymentResponseCode('')).toBe('FAILED');
    expect(mapIciciPaymentResponseCode('anything-unexpected')).toBe('FAILED');
  });
});

describe('mapIciciTxnStatusToInternalStatus (confirmed STATUS command txnStatus enum)', () => {
  it.each([
    ['SUC', 'SUCCESS'],
    ['REJ', 'FAILED'],
    ['ERR', 'FAILED'],
    ['REQ', 'PENDING'],
  ] as const)('maps txnStatus %s to %s', (status, expected) => {
    expect(mapIciciTxnStatusToInternalStatus(status)).toBe(expected);
  });

  it('maps an unrecognized txnStatus to UNKNOWN rather than guessing', () => {
    expect(mapIciciTxnStatusToInternalStatus('XYZ')).toBe('UNKNOWN');
    expect(mapIciciTxnStatusToInternalStatus('')).toBe('UNKNOWN');
  });
});
