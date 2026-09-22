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
    expect(() => buildIciciRedirectUrl('https://pgpay.icicibank.com/tsp/pg/somepage', 'ctx')).toThrow(
      IciciUnsafeRedirectError,
    );
  });

  it('rejects the real ICICI production host under an explicit environment="uat"', () => {
    expect(() => buildIciciRedirectUrl('https://pgpay.icicibank.com/tsp/pg/somepage', 'ctx', 'uat')).toThrow(
      IciciUnsafeRedirectError,
    );
  });

  it('accepts the real ICICI production host under environment="production"', () => {
    const result = buildIciciRedirectUrl('https://pgpay.icicibank.com/tsp/pg/somepage', 'ctx-prod', 'production');
    expect(result).toBe('https://pgpay.icicibank.com/tsp/pg/somepage?tranCtx=ctx-prod');
  });

  it('rejects the UAT host under environment="production" — the two can never be mixed', () => {
    expect(() => buildIciciRedirectUrl(VALID_REDIRECT, 'ctx', 'production')).toThrow(IciciUnsafeRedirectError);
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
