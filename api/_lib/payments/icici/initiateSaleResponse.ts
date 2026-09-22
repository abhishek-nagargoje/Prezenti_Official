/**
 * Validation for the ICICI Direct Orange PG Initiate Sale HTTP response.
 *
 * IMPORTANT: this response's `responseCode` is a DIFFERENT code space from
 * the final-payment response codes in responseCodes.ts (0000/0015/.../0399
 * — those describe how the *payment itself* concluded, delivered on the
 * return/callback leg). This module only concerns the Initiate Sale call
 * itself: did ICICI accept the request and hand back a redirect target?
 *
 * R1000 means "successful initiation" — the customer has NOT paid yet.
 * It must map to Prezenti's internal `INITIATED` status (awaiting the
 * customer to complete payment on ICICI's hosted page), never `SUCCESS`.
 */

export const ICICI_INITIATE_SALE_SUCCESS_CODE = 'R1000';

export interface IciciInitiateSaleResponse {
  responseCode?: unknown;
  merchantId?: unknown;
  aggregatorID?: unknown;
  merchantTxnNo?: unknown;
  redirectURI?: unknown;
  tranCtx?: unknown;
  [key: string]: unknown;
}

export interface IciciInitiateSaleExpected {
  merchantId: string;
  aggregatorID: string;
  merchantTxnNo: string;
}

export interface IciciInitiateSaleValidationError {
  field: string;
  reason: string;
}

export interface IciciInitiateSaleValidationResult {
  /** true only when the response is R1000 and every required field checks out. Never means "payment complete". */
  initiationAccepted: boolean;
  errors: IciciInitiateSaleValidationError[];
  redirectURI?: string;
  tranCtx?: string;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Validates an Initiate Sale response against what Prezenti actually
 * sent. Pure, no I/O. Never treats any responseCode — including
 * ICICI_INITIATE_SALE_SUCCESS_CODE — as evidence that the *payment* is
 * complete; it only confirms the initiation step and the presence of the
 * fields needed to redirect the customer.
 */
export function validateIciciInitiateSaleResponse(
  response: IciciInitiateSaleResponse,
  expected: IciciInitiateSaleExpected,
): IciciInitiateSaleValidationResult {
  const errors: IciciInitiateSaleValidationError[] = [];

  const responseCode = asNonEmptyString(response.responseCode);
  if (!responseCode) {
    errors.push({ field: 'responseCode', reason: 'missing or empty' });
  }

  const merchantId = asNonEmptyString(response.merchantId);
  if (!merchantId) {
    errors.push({ field: 'merchantId', reason: 'missing or empty' });
  } else if (merchantId !== expected.merchantId) {
    errors.push({ field: 'merchantId', reason: 'does not match the merchantId Prezenti sent' });
  }

  const aggregatorID = asNonEmptyString(response.aggregatorID);
  if (!aggregatorID) {
    errors.push({ field: 'aggregatorID', reason: 'missing or empty' });
  } else if (aggregatorID !== expected.aggregatorID) {
    errors.push({ field: 'aggregatorID', reason: 'does not match the aggregatorID Prezenti sent' });
  }

  const merchantTxnNo = asNonEmptyString(response.merchantTxnNo);
  if (!merchantTxnNo) {
    errors.push({ field: 'merchantTxnNo', reason: 'missing or empty' });
  } else if (merchantTxnNo !== expected.merchantTxnNo) {
    errors.push({ field: 'merchantTxnNo', reason: 'does not match the merchantTxnNo Prezenti generated' });
  }

  if (responseCode !== ICICI_INITIATE_SALE_SUCCESS_CODE) {
    // Any non-R1000 code is a rejected initiation. We don't attempt to
    // interpret its meaning further here — the caller surfaces the raw
    // code/description; we only assert it is not treated as accepted.
    return { initiationAccepted: false, errors };
  }

  const redirectURI = asNonEmptyString(response.redirectURI);
  if (!redirectURI) {
    errors.push({ field: 'redirectURI', reason: `missing or empty despite responseCode ${ICICI_INITIATE_SALE_SUCCESS_CODE}` });
  }

  const tranCtx = asNonEmptyString(response.tranCtx);
  if (!tranCtx) {
    errors.push({ field: 'tranCtx', reason: `missing or empty despite responseCode ${ICICI_INITIATE_SALE_SUCCESS_CODE}` });
  }

  return {
    initiationAccepted: errors.length === 0,
    errors,
    redirectURI,
    tranCtx,
  };
}
