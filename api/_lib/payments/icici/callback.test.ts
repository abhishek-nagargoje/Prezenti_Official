import { describe, expect, it } from 'vitest';
import {
  correlateWithLocalTransaction,
  processIciciReturn,
  validateIciciReturnPayloadShape,
  verifyIciciReturnSecureHash,
  type IciciReturnPayload,
  type LocalTransactionSnapshot,
} from './callback';
import { generateIciciHashV1 } from './crypto';

const TEST_KEY = 'test-fixture-key-not-a-real-secret';

// A well-shaped payload matching the doc's worked "Sample Response form"
// field set (page 27), with its secureHash independently computed
// (outside this codebase, via a standalone Node script implementing the
// documented algorithm by hand) so this test is a real, verifiable proof
// of correctness — not circular against this module's own logic.
const RAW_BODY: Record<string, string> = {
  responseCode: '0000',
  respDescription: 'SUCCESS',
  merchantId: 'M000001',
  merchantTxnNo: 'M0099999221',
  txnID: 'T1472640294491',
  paymentDateTime: '20160831041454',
  paymentID: '006503',
  secureHash: '09de87c6873a8aee2984318df372b0273c6eb80c740babd99ed14446c535b446',
};

const VALID_PAYLOAD: IciciReturnPayload = {
  responseCode: RAW_BODY.responseCode,
  respDescription: RAW_BODY.respDescription,
  merchantId: RAW_BODY.merchantId,
  merchantTxnNo: RAW_BODY.merchantTxnNo,
  txnID: RAW_BODY.txnID,
  paymentDateTime: RAW_BODY.paymentDateTime,
  paymentID: RAW_BODY.paymentID,
  secureHash: RAW_BODY.secureHash,
};

describe('verifyIciciReturnSecureHash', () => {
  it('accepts a correctly-hashed payload (independently computed reference hash)', () => {
    expect(verifyIciciReturnSecureHash(RAW_BODY, TEST_KEY)).toBe(true);
  });

  it('rejects when any single field value is tampered with (e.g. amount/response fields modified)', () => {
    expect(verifyIciciReturnSecureHash({ ...RAW_BODY, responseCode: '9999' }, TEST_KEY)).toBe(false);
    expect(verifyIciciReturnSecureHash({ ...RAW_BODY, merchantTxnNo: 'DIFFERENT' }, TEST_KEY)).toBe(false);
    expect(verifyIciciReturnSecureHash({ ...RAW_BODY, paymentID: '999999' }, TEST_KEY)).toBe(false);
  });

  it('rejects when the merchantTxnNo is tampered with even if secureHash is copied unchanged', () => {
    // The critical security property: an attacker who intercepts a
    // genuine response cannot just swap the merchant reference and reuse
    // the same secureHash — the hash covers merchantTxnNo too.
    const tampered = { ...RAW_BODY, merchantTxnNo: 'ATTACKER-CHOSEN-REF' };
    expect(verifyIciciReturnSecureHash(tampered, TEST_KEY)).toBe(false);
  });

  it('rejects when secureHash itself is missing', () => {
    const { secureHash: _drop, ...withoutHash } = RAW_BODY;
    void _drop;
    expect(verifyIciciReturnSecureHash(withoutHash, TEST_KEY)).toBe(false);
  });

  it('rejects when verified against the wrong key', () => {
    expect(verifyIciciReturnSecureHash(RAW_BODY, 'a-different-key')).toBe(false);
  });

  it('includes an extra, undocumented parameter in the hash if actually present (doc Note 1) — so adding one without recomputing the hash fails verification', () => {
    const withExtraParam = { ...RAW_BODY, someBankFieldNotInOurTypes: 'X' };
    expect(verifyIciciReturnSecureHash(withExtraParam, TEST_KEY)).toBe(false);
  });

  it('ignores query-string-style values by design — callers must pass POST-body-only params (doc-confirmed rule)', () => {
    // This test documents the contract: verifyIciciReturnSecureHash trusts
    // whatever object it's given as "the POST body" — it is the route
    // handler's responsibility (tested separately) to never pass query
    // params into this function.
    const queryOnly = { merchantTxnNo: RAW_BODY.merchantTxnNo, secureHash: RAW_BODY.secureHash };
    expect(verifyIciciReturnSecureHash(queryOnly, TEST_KEY)).toBe(false);
  });
});

describe('validateIciciReturnPayloadShape', () => {
  it('reports no errors for a fully-shaped payload', () => {
    expect(validateIciciReturnPayloadShape(VALID_PAYLOAD)).toEqual([]);
  });

  it('reports missing required fields', () => {
    const errors = validateIciciReturnPayloadShape({});
    const fields = errors.map((e) => e.field).sort();
    expect(fields).toEqual(['merchantTxnNo', 'responseCode', 'secureHash'].sort());
  });
});

describe('processIciciReturn', () => {
  it('rejects a malformed payload before ever attempting hash verification', () => {
    const result = processIciciReturn({}, {}, TEST_KEY);
    expect(result.outcome).toBe('REJECTED_INVALID_SHAPE');
    expect(result.status).toBe('UNKNOWN');
    expect(result.validationErrors).toBeDefined();
    expect(result.validationErrors!.length).toBeGreaterThan(0);
  });

  it('reaches a trusted VERIFIED/SUCCESS outcome for a correctly-hashed responseCode 0000 payload', () => {
    const result = processIciciReturn(VALID_PAYLOAD, RAW_BODY, TEST_KEY);
    expect(result.outcome).toBe('VERIFIED');
    expect(result.status).toBe('SUCCESS');
  });

  it('rejects (UNKNOWN) a well-shaped but incorrectly-hashed payload — never trusts responseCode alone', () => {
    const tamperedBody = { ...RAW_BODY, responseCode: '0000', amount: '999999.00' };
    const tamperedPayload: IciciReturnPayload = { ...VALID_PAYLOAD };
    const result = processIciciReturn(tamperedPayload, tamperedBody, TEST_KEY);

    expect(result.outcome).toBe('REJECTED_HASH_MISMATCH');
    expect(result.status).toBe('UNKNOWN');
    expect(result.status).not.toBe('SUCCESS');
  });

  it('maps R1000 (verified) to PENDING, never SUCCESS — initiation/out-of-band only', () => {
    const r1000Fields: Record<string, string> = { ...RAW_BODY, responseCode: 'R1000' };
    delete r1000Fields.secureHash;
    const r1000Body: Record<string, string> = { ...r1000Fields, secureHash: generateIciciHashV1(r1000Fields, TEST_KEY) };

    const result = processIciciReturn({ ...VALID_PAYLOAD, responseCode: 'R1000' }, r1000Body, TEST_KEY);
    expect(result.outcome).toBe('VERIFIED');
    expect(result.status).toBe('PENDING');
    expect(result.status).not.toBe('SUCCESS');
  });
});

describe('correlateWithLocalTransaction', () => {
  const CONFIG = { merchantId: '100000000007164', aggregatorId: 'A100000000007164' };
  const LOCAL: LocalTransactionSnapshot = { amount: '2.00', status: 'INITIATED' };
  const PAYLOAD: IciciReturnPayload = {
    merchantTxnNo: 'PZ123ABC',
    merchantId: '100000000007164',
    aggregatorID: 'A100000000007164',
    amount: '2.00',
  };

  it('passes through the verified status when everything correlates', () => {
    expect(correlateWithLocalTransaction(PAYLOAD, 'SUCCESS', LOCAL, CONFIG)).toBe('SUCCESS');
  });

  it('returns UNKNOWN when there is no local transaction to correlate against', () => {
    expect(correlateWithLocalTransaction(PAYLOAD, 'SUCCESS', null, CONFIG)).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when the payload amount does not match the locally initiated amount', () => {
    const result = correlateWithLocalTransaction({ ...PAYLOAD, amount: '999.00' }, 'SUCCESS', LOCAL, CONFIG);
    expect(result).toBe('UNKNOWN');
  });

  it('tolerates trivial decimal-formatting differences in amount (e.g. "2.00" vs "2.0")', () => {
    const result = correlateWithLocalTransaction({ ...PAYLOAD, amount: '2.0' }, 'SUCCESS', LOCAL, CONFIG);
    expect(result).toBe('SUCCESS');
  });

  it('returns UNKNOWN when the payload merchantId does not match our configured merchant ID', () => {
    const result = correlateWithLocalTransaction({ ...PAYLOAD, merchantId: 'someone-else' }, 'SUCCESS', LOCAL, CONFIG);
    expect(result).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when the payload aggregatorID does not match our configured aggregator ID', () => {
    const result = correlateWithLocalTransaction({ ...PAYLOAD, aggregatorID: 'A-someone-else' }, 'SUCCESS', LOCAL, CONFIG);
    expect(result).toBe('UNKNOWN');
  });

  it('never downgrades an already-SUCCESS local transaction, even for a mismatched/failing new callback', () => {
    const successLocal: LocalTransactionSnapshot = { amount: '2.00', status: 'SUCCESS' };
    const staleFailurePayload: IciciReturnPayload = { ...PAYLOAD, amount: '999.00' };
    expect(correlateWithLocalTransaction(staleFailurePayload, 'FAILED', successLocal, CONFIG)).toBe('SUCCESS');
  });

  it('does not require merchantId/aggregatorID/amount to be present to correlate (only checks fields that are actually given)', () => {
    const minimalPayload: IciciReturnPayload = { merchantTxnNo: 'PZ123ABC' };
    expect(correlateWithLocalTransaction(minimalPayload, 'SUCCESS', LOCAL, CONFIG)).toBe('SUCCESS');
  });
});
