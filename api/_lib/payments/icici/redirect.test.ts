import { describe, expect, it } from 'vitest';
import { buildIciciRedirectUrl, IciciUnsafeRedirectError } from './redirect';

const VALID_REDIRECT = 'https://pgpayuat.icicibank.com/tsp/pg/somepage';

describe('buildIciciRedirectUrl', () => {
  it('appends tranCtx as a query parameter to a valid UAT redirectURI', () => {
    const result = buildIciciRedirectUrl(VALID_REDIRECT, 'ctx-abc-123');
    expect(result).toBe('https://pgpayuat.icicibank.com/tsp/pg/somepage?tranCtx=ctx-abc-123');
  });

  it('preserves existing query parameters on the redirectURI', () => {
    const result = buildIciciRedirectUrl(`${VALID_REDIRECT}?existing=1`, 'ctx-abc-123');
    const url = new URL(result);
    expect(url.searchParams.get('existing')).toBe('1');
    expect(url.searchParams.get('tranCtx')).toBe('ctx-abc-123');
  });

  it('rejects a non-HTTPS redirectURI', () => {
    expect(() => buildIciciRedirectUrl('http://pgpayuat.icicibank.com/tsp/pg/somepage', 'ctx')).toThrow(
      IciciUnsafeRedirectError,
    );
  });

  it('rejects a redirectURI on an unexpected host, even a plausible-looking one', () => {
    expect(() => buildIciciRedirectUrl('https://pgpayuat.icicibank.com.evil.example.com/page', 'ctx')).toThrow(
      IciciUnsafeRedirectError,
    );
    expect(() => buildIciciRedirectUrl('https://evil.example.com/page', 'ctx')).toThrow(IciciUnsafeRedirectError);
  });

  it('rejects the real ICICI production host under the default (UAT) environment', () => {
    expect(() => buildIciciRedirectUrl('https://pgpay.icicibank.com/pg/somepage', 'ctx')).toThrow(
      IciciUnsafeRedirectError,
    );
  });

  it('rejects the real ICICI production host under an explicit environment="uat"', () => {
    expect(() => buildIciciRedirectUrl('https://pgpay.icicibank.com/pg/somepage', 'ctx', 'uat')).toThrow(
      IciciUnsafeRedirectError,
    );
  });

  it('accepts pgpay.icicibank.com under environment="production"', () => {
    const result = buildIciciRedirectUrl('https://pgpay.icicibank.com/pg/somepage', 'ctx-prod', 'production');
    expect(result).toBe('https://pgpay.icicibank.com/pg/somepage?tranCtx=ctx-prod');
  });

  it('accepts pgpay.icici.bank.in under environment="production" (confirmed live: ICICI\'s actual hosted-payment-page redirect host)', () => {
    const result = buildIciciRedirectUrl('https://pgpay.icici.bank.in/pg/somepage', 'ctx-prod', 'production');
    expect(result).toBe('https://pgpay.icici.bank.in/pg/somepage?tranCtx=ctx-prod');
  });

  it('rejects an arbitrary attacker-controlled host under environment="production", even one that looks plausible', () => {
    expect(() => buildIciciRedirectUrl('https://pgpay.icici.bank.in.evil.example.com/page', 'ctx', 'production')).toThrow(
      IciciUnsafeRedirectError,
    );
    expect(() => buildIciciRedirectUrl('https://evil.example.com/page', 'ctx', 'production')).toThrow(
      IciciUnsafeRedirectError,
    );
  });

  it('rejects HTTP (not HTTPS) even for an otherwise-allowed production hostname', () => {
    expect(() => buildIciciRedirectUrl('http://pgpay.icici.bank.in/pg/somepage', 'ctx', 'production')).toThrow(
      IciciUnsafeRedirectError,
    );
    expect(() => buildIciciRedirectUrl('http://pgpay.icicibank.com/pg/somepage', 'ctx', 'production')).toThrow(
      IciciUnsafeRedirectError,
    );
  });

  it('rejects the UAT host under environment="production" — the two can never be mixed', () => {
    expect(() => buildIciciRedirectUrl(VALID_REDIRECT, 'ctx', 'production')).toThrow(IciciUnsafeRedirectError);
  });

  it('rejects pgpay.icici.bank.in under environment="uat" (production redirect hosts never bleed into UAT)', () => {
    expect(() => buildIciciRedirectUrl('https://pgpay.icici.bank.in/pg/somepage', 'ctx', 'uat')).toThrow(
      IciciUnsafeRedirectError,
    );
  });

  it('rejects a malformed URL', () => {
    expect(() => buildIciciRedirectUrl('not-a-url', 'ctx')).toThrow(IciciUnsafeRedirectError);
  });

  it('URL-encodes tranCtx values that need it', () => {
    const result = buildIciciRedirectUrl(VALID_REDIRECT, 'ctx with spaces & symbols');
    const url = new URL(result);
    expect(url.searchParams.get('tranCtx')).toBe('ctx with spaces & symbols');
  });
});
