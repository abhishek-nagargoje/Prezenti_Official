import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInitiateIciciPayment = vi.fn();
const mockCreateSupabaseClientFromEnv = vi.fn().mockReturnValue({});
const mockCreateRepo = vi.fn().mockReturnValue({});

vi.mock('../../_lib/payments/icici/initiateSaleService', async () => {
  const actual = await vi.importActual<typeof import('../../_lib/payments/icici/initiateSaleService')>(
    '../../_lib/payments/icici/initiateSaleService',
  );
  return {
    ...actual,
    initiateIciciPayment: (...args: unknown[]) => mockInitiateIciciPayment(...args),
  };
});

vi.mock('../../_lib/payments/icici/repository', () => ({
  createSupabaseClientFromEnv: () => mockCreateSupabaseClientFromEnv(),
  createSupabasePaymentTransactionRepository: () => mockCreateRepo(),
}));

const { default: handler } = await import('./initiate');
const { IciciInitiateSaleValidationError } = await import('../../_lib/payments/icici/initiateSaleService');

function createResponse() {
  const state = { statusCode: 0, jsonBody: undefined as unknown, ended: false };
  const headers: Record<string, string> = {};
  const response = {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      state.jsonBody = body;
    }),
    end: vi.fn(() => {
      state.ended = true;
    }),
  };
  return { response, headers, state };
}

const VALID_BODY = {
  internalReference: 'QUOTE-001',
  customerEmailID: 'customer@example.com',
  customerMobileNo: '919876543210',
  customerName: 'Test Customer',
};

describe('POST /api/payments/icici/initiate', () => {
  beforeEach(() => {
    mockInitiateIciciPayment.mockReset();
    process.env.ICICI_ENV = 'uat';
    process.env.ICICI_MERCHANT_ID = '100000000007164';
    process.env.ICICI_AGGREGATOR_ID = 'A100000000007164';
    process.env.ICICI_HASH_KEY = 'test-fixture-key-not-a-real-secret';
    process.env.ICICI_RETURN_URL = 'https://prezenti.com/api/payments/icici/return';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ICICI_ENV;
    delete process.env.ICICI_MERCHANT_ID;
    delete process.env.ICICI_AGGREGATOR_ID;
    delete process.env.ICICI_HASH_KEY;
    delete process.env.ICICI_RETURN_URL;
  });

  it('rejects non-POST/OPTIONS methods', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'GET', headers: {} }, response as never);
    expect(state.statusCode).toBe(405);
  });

  it('responds 204 to OPTIONS (CORS preflight)', async () => {
    const { response, state } = createResponse();
    await handler({ method: 'OPTIONS', headers: {} }, response as never);
    expect(state.statusCode).toBe(204);
    expect(mockInitiateIciciPayment).not.toHaveBeenCalled();
  });

  it('on a valid request, calls initiateIciciPayment and returns its safe result with 200', async () => {
    mockInitiateIciciPayment.mockResolvedValueOnce({
      safeResult: { success: true, merchantTxnNo: 'PZ123ABC', redirectURI: 'https://pgpayuat.icicibank.com/x', tranCtx: 'ctx' },
      preview: {},
      httpStatus: 200,
      rawResponseCode: 'R1000',
    });

    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: VALID_BODY }, response as never);

    expect(mockInitiateIciciPayment).toHaveBeenCalledWith(VALID_BODY, expect.objectContaining({ config: expect.any(Object) }));
    expect(state.statusCode).toBe(200);
    expect(state.jsonBody).toEqual(
      expect.objectContaining({ success: true, merchantTxnNo: 'PZ123ABC', redirectURI: 'https://pgpayuat.icicibank.com/x' }),
    );
  });

  it('rejects an invalid/incomplete request body with 400, without ever calling the gateway', async () => {
    mockInitiateIciciPayment.mockRejectedValueOnce(new IciciInitiateSaleValidationError('Missing required field(s)'));

    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: { internalReference: 'QUOTE-001' } }, response as never);

    expect(state.statusCode).toBe(400);
    expect(state.jsonBody).not.toHaveProperty('stack');
  });

  it('returns 502 (not 200) when the provider rejects the request, and never claims success', async () => {
    mockInitiateIciciPayment.mockResolvedValueOnce({
      safeResult: { success: false, merchantTxnNo: 'PZ123ABC', message: 'The payment gateway rejected this request.' },
      preview: {},
      httpStatus: 200,
      rawResponseCode: 'R1001',
    });

    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: VALID_BODY }, response as never);

    expect(state.statusCode).toBe(502);
    expect((state.jsonBody as { success: boolean }).success).toBe(false);
  });

  it('returns a safe 500 (no internal details leaked) on a truly unexpected/uncaught error', async () => {
    mockInitiateIciciPayment.mockRejectedValueOnce(new Error('Unexpected token < in JSON at position 0'));

    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: VALID_BODY }, response as never);

    expect(state.statusCode).toBe(500);
    expect(JSON.stringify(state.jsonBody)).not.toContain('JSON at position');
  });

  it('returns 503 (not 500) when the failure is our own persistence layer (errorKind PERSISTENCE)', async () => {
    mockInitiateIciciPayment.mockResolvedValueOnce({
      safeResult: { success: false, message: 'Unable to start your payment right now. Please try again.' },
      preview: {},
      errorKind: 'PERSISTENCE',
    });

    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: VALID_BODY }, response as never);

    expect(state.statusCode).toBe(503);
    expect((state.jsonBody as { success: boolean }).success).toBe(false);
  });

  it('returns 502 (not 500) when ICICI itself is unreachable at the network level (errorKind GATEWAY_UNREACHABLE)', async () => {
    mockInitiateIciciPayment.mockResolvedValueOnce({
      safeResult: { success: false, merchantTxnNo: 'PZ123ABC', message: 'Unable to reach the payment gateway. Please try again.' },
      preview: {},
      errorKind: 'GATEWAY_UNREACHABLE',
    });

    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: VALID_BODY }, response as never);

    expect(state.statusCode).toBe(502);
    expect((state.jsonBody as { success: boolean }).success).toBe(false);
  });

  it('logs rawResponseDescription server-side for diagnosis, but never includes it in the browser-facing response body', async () => {
    mockInitiateIciciPayment.mockResolvedValueOnce({
      safeResult: { success: false, merchantTxnNo: 'PZ123ABC', message: 'The payment gateway rejected this request.' },
      preview: {},
      httpStatus: 200,
      rawResponseCode: 'P1006',
      rawResponseDescription: 'Invalid request: Secure hash does not match',
    });

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: VALID_BODY }, response as never);

    expect(infoSpy).toHaveBeenCalledWith(
      '[ICICI INITIATE]',
      expect.objectContaining({ rawResponseDescription: 'Invalid request: Secure hash does not match' }),
    );
    infoSpy.mockRestore();
    expect(JSON.stringify(state.jsonBody)).not.toContain('Secure hash does not match');
  });

  it('never returns the hash key, service key, or any internal config in the response body', async () => {
    mockInitiateIciciPayment.mockResolvedValueOnce({
      safeResult: { success: true, merchantTxnNo: 'PZ123ABC', redirectURI: 'https://pgpayuat.icicibank.com/x', tranCtx: 'ctx' },
      preview: {},
      httpStatus: 200,
      rawResponseCode: 'R1000',
    });

    const { response } = createResponse();
    await handler({ method: 'POST', headers: {}, body: VALID_BODY }, response as never);

    const serialized = JSON.stringify(response.json.mock.calls[0][0]);
    expect(serialized).not.toContain('test-fixture-key-not-a-real-secret');
    expect(serialized).not.toMatch(/hashKey|secureHash/i);
  });

  it('returns 503 without leaking which env var is missing when ICICI config is incomplete', async () => {
    delete process.env.ICICI_HASH_KEY;

    const { response, state } = createResponse();
    await handler({ method: 'POST', headers: {}, body: VALID_BODY }, response as never);

    expect(state.statusCode).toBe(503);
    expect(JSON.stringify(state.jsonBody)).not.toContain('ICICI_HASH_KEY');
    expect(mockInitiateIciciPayment).not.toHaveBeenCalled();
  });
});
