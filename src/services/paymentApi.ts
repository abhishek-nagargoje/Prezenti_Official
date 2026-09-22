const initiateEndpoint = '/api/payments/icici/initiate';
const statusEndpoint = '/api/payments/icici/status';
const requestTimeoutMs = 20_000;

export interface InitiatePaymentRequest {
  internalReference: string;
  customerEmailID: string;
  customerMobileNo: string;
  customerName: string;
}

export interface InitiatePaymentResponse {
  success: boolean;
  merchantTxnNo?: string;
  redirectURI?: string;
  tranCtx?: string;
  message?: string;
}

export interface PaymentStatusResponse {
  success: boolean;
  transaction?: {
    merchantTxnNo: string;
    status: 'INITIATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'UNKNOWN';
    amount: string;
    currency: string;
    responseDescription?: string;
    paymentMode?: string;
    paymentDatetime?: string;
  };
  message?: string;
}

async function parseResponse<T>(response: Response): Promise<Partial<T>> {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    return {};
  }

  return response.json() as Promise<Partial<T>>;
}

export async function initiatePayment(payload: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(initiateEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await parseResponse<InitiatePaymentResponse>(response);

    if (!response.ok) {
      throw new Error(data.message || 'Unable to start your payment. Please try again.');
    }

    return {
      success: data.success === true,
      merchantTxnNo: data.merchantTxnNo,
      redirectURI: data.redirectURI,
      tranCtx: data.tranCtx,
      message: data.message,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Payment request timed out. Please try again.', { cause: error });
    }

    throw new Error(error instanceof Error ? error.message : 'Unable to start your payment. Please try again.', {
      cause: error,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function getPaymentStatus(merchantTxnNo: string): Promise<PaymentStatusResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${statusEndpoint}?merchantTxnNo=${encodeURIComponent(merchantTxnNo)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    const data = await parseResponse<PaymentStatusResponse>(response);

    if (!response.ok) {
      throw new Error(data.message || 'Unable to retrieve your payment status. Please try again.');
    }

    return {
      success: data.success === true,
      transaction: data.transaction,
      message: data.message,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Payment status request timed out. Please try again.', { cause: error });
    }

    throw new Error(
      error instanceof Error ? error.message : 'Unable to retrieve your payment status. Please try again.',
      { cause: error },
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}
