import { describe, expect, it, vi } from 'vitest';
import { ICICI_PRODUCTION_DEFAULT_URLS } from './env';
import {
  assertIciciUatHost,
  IciciProductionCallBlockedError,
  IciciRequestTimeoutError,
  IciciUnexpectedHostError,
  postIciciCommand,
  postIciciInitiateSale,
} from './httpClient';
import type { IciciInitiateSaleRequestBody } from './requestBuilder';

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

describe('assertIciciUatHost', () => {
  it('allows the UAT host', () => {
    expect(() => assertIciciUatHost('https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale')).not.toThrow();
  });

  it('blocks the known production host explicitly', () => {
    expect(() => assertIciciUatHost(ICICI_PRODUCTION_DEFAULT_URLS.initiateSaleUrl)).toThrow(
      IciciProductionCallBlockedError,
    );
  });

  it('blocks any other unrecognized host', () => {
    expect(() => assertIciciUatHost('https://evil.example.com/initiateSale')).toThrow(IciciUnexpectedHostError);
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
