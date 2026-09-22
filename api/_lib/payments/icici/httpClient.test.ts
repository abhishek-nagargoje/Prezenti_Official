import { describe, expect, it, vi } from 'vitest';
import { ICICI_PRODUCTION_DEFAULT_URLS, ICICI_UAT_HOSTNAME } from './env';
import {
  assertIciciHostMatchesEnvironment,
  IciciProductionCallBlockedError,
  IciciRequestTimeoutError,
  IciciUnexpectedHostError,
  postIciciCommand,
  postIciciInitiateSale,
} from './httpClient';
import type { IciciInitiateSaleRequestBody } from './requestBuilder';

const UAT_INITIATE_SALE_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale';

const SAMPLE_BODY: IciciInitiateSaleRequestBody = {
  merchantId: '100000000007164',
  aggregatorID: 'A100000000007164',
  merchantTxnNo: 'PZ123ABC',
  amount: '2.00',
  currencyCode: '356',
  payType: '0',
  customerEmailID: 'customer@example.com',
  transactionType: 'SALE',
  returnURL: 'https://prezenti.com/api/payments/icici/return',
  txnDate: '20241121115413',
  customerMobileNo: '919876543210',
  customerName: 'Test Customer',
  addlParam1: '',
  addlParam2: '',
  secureHash: 'deadbeef',
};

describe('assertIciciHostMatchesEnvironment', () => {
  it('ICICI UAT host => allowed under environment "uat"', () => {
    expect(() => assertIciciHostMatchesEnvironment(UAT_INITIATE_SALE_URL, 'uat')).not.toThrow();
  });

  it('ICICI Production host => rejected under environment "uat" (blocked explicitly, not just "unexpected")', () => {
    expect(() => assertIciciHostMatchesEnvironment(ICICI_PRODUCTION_DEFAULT_URLS.initiateSaleUrl, 'uat')).toThrow(
      IciciProductionCallBlockedError,
    );
  });

  it('ICICI Production host => allowed under environment "production"', () => {
    expect(() =>
      assertIciciHostMatchesEnvironment(ICICI_PRODUCTION_DEFAULT_URLS.initiateSaleUrl, 'production'),
    ).not.toThrow();
  });

  it('ICICI UAT host => rejected under environment "production" (never mixed, in either direction)', () => {
    expect(() => assertIciciHostMatchesEnvironment(UAT_INITIATE_SALE_URL, 'production')).toThrow(
      IciciUnexpectedHostError,
    );
  });

  it('blocks any other unrecognized host regardless of environment', () => {
    expect(() => assertIciciHostMatchesEnvironment('https://evil.example.com/initiateSale', 'uat')).toThrow(
      IciciUnexpectedHostError,
    );
    expect(() => assertIciciHostMatchesEnvironment('https://evil.example.com/initiateSale', 'production')).toThrow(
      IciciUnexpectedHostError,
    );
  });

  it('confirms the two hostnames are actually distinct (a meaningless test if they were ever accidentally equal)', () => {
    expect(ICICI_UAT_HOSTNAME).not.toBe(ICICI_PRODUCTION_DEFAULT_URLS.initiateSaleUrl);
    expect(new URL(ICICI_PRODUCTION_DEFAULT_URLS.initiateSaleUrl).hostname).not.toBe(ICICI_UAT_HOSTNAME);
  });
});

describe('postIciciInitiateSale', () => {
  it('refuses to call a production host even if passed in by a caller bug', async () => {
    const fetchImpl = vi.fn();
    await expect(
      postIciciInitiateSale(ICICI_PRODUCTION_DEFAULT_URLS.initiateSaleUrl, SAMPLE_BODY, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(IciciProductionCallBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs JSON to the UAT host and parses a JSON response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ responseCode: 'R1000', redirectURI: 'https://x', tranCtx: 'ctx' }),
    });

    const result = await postIciciInitiateSale(
      'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale',
      SAMPLE_BODY,
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe('https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calledInit.body)).toEqual(SAMPLE_BODY);

    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ responseCode: 'R1000', redirectURI: 'https://x', tranCtx: 'ctx' });
  });

  it('reports a parse error instead of throwing when the response body is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 502, text: async () => '<html>Bad Gateway</html>' });

    const result = await postIciciInitiateSale(
      'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale',
      SAMPLE_BODY,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.httpStatus).toBe(502);
    expect(result.body).toBeNull();
    expect(result.parseError).toBeDefined();
  });

  it('throws IciciRequestTimeoutError (never a silent retry) when the request aborts', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    await expect(
      postIciciInitiateSale(
        'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale',
        SAMPLE_BODY,
        fetchImpl as unknown as typeof fetch,
        50,
      ),
    ).rejects.toThrow(IciciRequestTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('defaults to environment "uat" when omitted — a call site that forgets the parameter can never accidentally reach production', async () => {
    const fetchImpl = vi.fn();
    await expect(
      postIciciInitiateSale(ICICI_PRODUCTION_DEFAULT_URLS.initiateSaleUrl, SAMPLE_BODY, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(IciciProductionCallBlockedError);
  });

  it('Production website + ICICI Production (environment="production" explicitly passed) => allowed to reach the production host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ responseCode: 'R1000', redirectURI: 'https://x', tranCtx: 'ctx' }),
    });

    const result = await postIciciInitiateSale(
      ICICI_PRODUCTION_DEFAULT_URLS.initiateSaleUrl,
      SAMPLE_BODY,
      fetchImpl as unknown as typeof fetch,
      undefined,
      'production',
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.httpStatus).toBe(200);
  });

  it('Production website + ICICI UAT (environment="uat" explicitly passed) => allowed to reach the UAT host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ responseCode: 'R1000', redirectURI: 'https://x', tranCtx: 'ctx' }),
    });

    const result = await postIciciInitiateSale(
      UAT_INITIATE_SALE_URL,
      SAMPLE_BODY,
      fetchImpl as unknown as typeof fetch,
      undefined,
      'uat',
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.httpStatus).toBe(200);
  });

  it('rejects the UAT host even when environment="production" is explicitly passed — the two can never be mixed', async () => {
    const fetchImpl = vi.fn();
    await expect(
      postIciciInitiateSale(UAT_INITIATE_SALE_URL, SAMPLE_BODY, fetchImpl as unknown as typeof fetch, undefined, 'production'),
    ).rejects.toThrow(IciciUnexpectedHostError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('postIciciCommand', () => {
  const COMMAND_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/command';
  const STATUS_FIELDS = {
    merchantId: '100000000007164',
    merchantTxnNo: 'PZ123ABC',
    originalTxnNo: 'PZ123ABC',
    transactionType: 'STATUS',
    secureHash: 'deadbeef',
  };

  it('refuses to call a production host even if passed in by a caller bug', async () => {
    const fetchImpl = vi.fn();
    await expect(
      postIciciCommand(ICICI_PRODUCTION_DEFAULT_URLS.commandUrl, STATUS_FIELDS, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(IciciProductionCallBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs application/x-www-form-urlencoded to the UAT host (doc-confirmed transport)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ txnStatus: 'SUC', txnResponseCode: '0000' }),
    });

    const result = await postIciciCommand(COMMAND_URL, STATUS_FIELDS, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(COMMAND_URL);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(calledInit.body).toContain('merchantTxnNo=PZ123ABC');
    expect(calledInit.body).toContain('transactionType=STATUS');

    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ txnStatus: 'SUC', txnResponseCode: '0000' });
  });

  it('reports a parse error instead of throwing when the response body is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 502, text: async () => '<html>Bad Gateway</html>' });

    const result = await postIciciCommand(COMMAND_URL, STATUS_FIELDS, fetchImpl as unknown as typeof fetch);

    expect(result.httpStatus).toBe(502);
    expect(result.body).toBeNull();
    expect(result.parseError).toBeDefined();
  });

  it('throws IciciRequestTimeoutError when the request aborts', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    await expect(
      postIciciCommand(COMMAND_URL, STATUS_FIELDS, fetchImpl as unknown as typeof fetch, 50),
    ).rejects.toThrow(IciciRequestTimeoutError);
  });
});
