/**
 * Orchestrates one ICICI Direct Orange PG Initiate Sale flow end to end:
 * validate input -> resolve transaction data -> generate merchantTxnNo/
 * txnDate -> build request + hash -> call ICICI (UAT only) -> validate
 * response -> persist -> return only safe fields to the frontend.
 *
 * AMOUNT: Prezenti's production order/quote pricing architecture does not
 * exist yet (no amount field anywhere in the quote data model — see the
 * earlier gap report). Per instruction, this service therefore uses a
 * fixed, server-side-only UAT test amount and NEVER reads an amount from
 * caller input — `IciciInitiateSaleServiceInput` has no amount field at
 * all, so a browser-supplied amount is structurally impossible to reach
 * ICICI through this code path. Replace `UAT_TEST_AMOUNT` with real
 * server-resolved pricing only once that architecture exists.
 */

import { generateIciciMerchantTxnNo } from './merchantTxnNo';
import { generateIciciTxnDate } from './txnDate';
import { buildIciciInitiateSaleRequestBody } from './requestBuilder';
import { buildIciciInitiateSalePreview, type IciciInitiateSalePreview } from './redactedPreview';
import { postIciciInitiateSale } from './httpClient';
import { validateIciciInitiateSaleResponse } from './initiateSaleResponse';
import { buildIciciRedirectUrl, IciciUnsafeRedirectError } from './redirect';
import type { IciciConfig } from './env';
import type { PaymentTransactionRepository } from './repository';

/** Fixed UAT validation amount, per instruction — matches the ICICI documented sample. Never sourced from the browser. */
export const ICICI_UAT_TEST_AMOUNT = '2.00';

export interface IciciInitiateSaleServiceInput {
  /** Prezenti's own reference for what this payment is for (e.g. a QuoteDraft.quoteId). Never a bank ID. */
  internalReference: string;
  customerEmailID: string;
  customerMobileNo: string;
  customerName: string;
}

export interface IciciInitiateSaleServiceDeps {
  config: IciciConfig;
  repository: PaymentTransactionRepository;
  fetchImpl?: typeof fetch;
  now?: Date;
}

/** Only these fields may ever reach the frontend — never the hash key, credentials, or raw gateway payload. */
export interface IciciInitiateSaleSafeResult {
  success: boolean;
  merchantTxnNo?: string;
  redirectURI?: string;
  tranCtx?: string;
  message?: string;
}

export interface IciciInitiateSaleServiceResult {
  safeResult: IciciInitiateSaleSafeResult;
  preview: IciciInitiateSalePreview;
  httpStatus?: number;
  rawResponseCode?: string;
  /**
   * Set only when `safeResult.success` is false, to let the route choose
   * an accurate HTTP status without re-deriving it: `PERSISTENCE` means
   * Prezenti's own database couldn't be written to (maps to 503, same
   * family as the existing config-unavailable checks); `GATEWAY_UNREACHABLE`
   * means the outbound call to ICICI itself failed at the network/transport
   * level — DNS, TLS, connection reset, timeout, or the UAT-host guard
   * rejecting a misconfigured URL — as opposed to ICICI returning a clean
   * but unusable HTTP response, which the existing `!httpResult.body`
   * branch already handles (maps to 502, "bad gateway", same as ICICI
   * rejecting the request outright).
   */
  errorKind?: 'PERSISTENCE' | 'GATEWAY_UNREACHABLE';
}

export class IciciInitiateSaleValidationError extends Error {}

/**
 * Records an Initiate Sale outcome without letting a persistence failure
 * propagate — by the point this is called, ICICI has already responded
 * (or we've already decided on a safe failure message), so a secondary
 * DB write failure must be logged, not allowed to turn an otherwise-safe
 * result into an uncaught error.
 */
async function recordOutcomeSafely(
  deps: IciciInitiateSaleServiceDeps,
  outcome: Parameters<PaymentTransactionRepository['recordInitiateSaleOutcome']>[0],
): Promise<void> {
  try {
    await deps.repository.recordInitiateSaleOutcome(outcome);
  } catch (error) {
    console.error('[ICICI INITIATE] failed to record outcome:', error instanceof Error ? error.message : error);
  }
}

function validateInput(input: IciciInitiateSaleServiceInput): void {
  const missing = (['internalReference', 'customerEmailID', 'customerMobileNo', 'customerName'] as const).filter(
    (key) => !input[key] || input[key].trim().length === 0,
  );

  if (missing.length > 0) {
    throw new IciciInitiateSaleValidationError(`Missing required field(s): ${missing.join(', ')}`);
  }
}

/**
 * Runs one full Initiate Sale attempt. Always returns a preview (built
 * before the network call) so callers can log/display it even on
 * failure; `safeResult` is what may ever reach the frontend.
 */
export async function initiateIciciPayment(
  input: IciciInitiateSaleServiceInput,
  deps: IciciInitiateSaleServiceDeps,
): Promise<IciciInitiateSaleServiceResult> {
  validateInput(input);

  const merchantTxnNo = generateIciciMerchantTxnNo(deps.now?.getTime());
  const txnDate = generateIciciTxnDate(deps.now);

  const transactionInput = {
    merchantTxnNo,
    amount: ICICI_UAT_TEST_AMOUNT,
    txnDate,
    customerEmailID: input.customerEmailID,
    customerMobileNo: input.customerMobileNo,
    customerName: input.customerName,
    returnURL: deps.config.returnUrl,
  };

  // Built before the DB write and the ICICI call — pure/no I/O, so it's
  // available for a safe failure response regardless of which step below
  // fails, and never varies based on whether either succeeds.
  const requestBody = buildIciciInitiateSaleRequestBody(transactionInput, deps.config);
  const preview = buildIciciInitiateSalePreview(requestBody, deps.config.initiateSaleUrl);

  try {
    await deps.repository.createInitiatedTransaction({
      merchantTxnNo,
      amount: ICICI_UAT_TEST_AMOUNT,
      currencyCode: deps.config.currencyCode,
      internalReference: input.internalReference,
      transactionInput,
    });
  } catch (error) {
    // A DB failure here means Prezenti's own persistence layer is
    // unavailable — this must never reach ICICI (no record would exist
    // to reconcile against) and must never surface as a raw 500 with an
    // unclassified message. Previously uncaught; this was one real
    // source of the generic 500 this integration was seeing in
    // production.
    console.error('[ICICI INITIATE] failed to persist initiated transaction:', error instanceof Error ? error.message : error);
    return {
      safeResult: { success: false, message: 'Unable to start your payment right now. Please try again.' },
      preview,
      errorKind: 'PERSISTENCE',
    };
  }

  let httpResult;
  try {
    httpResult = await postIciciInitiateSale(deps.config.initiateSaleUrl, requestBody, deps.fetchImpl);
  } catch (error) {
    // Any network/transport-level failure calling ICICI itself — DNS,
    // TLS, connection reset/refused, our own request timeout, or the
    // UAT-host guard rejecting a misconfigured URL. Distinct from ICICI
    // returning a real (if unusable) HTTP response, which the
    // `!httpResult.body` branch below already handles safely. Previously
    // uncaught; this was the other real source of the generic 500.
    console.error('[ICICI INITIATE] gateway call failed:', error instanceof Error ? error.message : error);

    await recordOutcomeSafely(deps, {
      merchantTxnNo,
      status: 'UNKNOWN',
      rawInitiateResponse: { networkError: error instanceof Error ? error.message : 'unknown error' },
    });

    return {
      safeResult: { success: false, merchantTxnNo, message: 'Unable to reach the payment gateway. Please try again.' },
      preview,
      errorKind: 'GATEWAY_UNREACHABLE',
    };
  }

  if (!httpResult.body) {
    await recordOutcomeSafely(deps, {
      merchantTxnNo,
      status: 'UNKNOWN',
      rawInitiateResponse: { httpStatus: httpResult.httpStatus, parseError: httpResult.parseError },
    });

    return {
      safeResult: { success: false, merchantTxnNo, message: 'Unable to reach the payment gateway. Please try again.' },
      preview,
      httpStatus: httpResult.httpStatus,
    };
  }

  const validation = validateIciciInitiateSaleResponse(httpResult.body, {
    merchantId: deps.config.merchantId,
    aggregatorID: deps.config.aggregatorId,
    merchantTxnNo,
  });

  const rawResponseCode = typeof httpResult.body.responseCode === 'string' ? httpResult.body.responseCode : undefined;

  if (!validation.initiationAccepted) {
    await recordOutcomeSafely(deps, {
      merchantTxnNo,
      status: 'FAILED',
      responseCode: rawResponseCode,
      rawInitiateResponse: httpResult.body,
    });

    return {
      safeResult: {
        success: false,
        merchantTxnNo,
        message: 'The payment gateway rejected this request. Please try again or contact support.',
      },
      preview,
      httpStatus: httpResult.httpStatus,
      rawResponseCode,
    };
  }

  // Build and validate the actual redirect URL BEFORE trusting this as a
  // safe initiation — an accepted responseCode is not sufficient on its
  // own if ICICI (or a network intermediary) ever returned something
  // that isn't a genuine HTTPS UAT redirect target.
  let safeRedirectUrl: string;
  try {
    safeRedirectUrl = buildIciciRedirectUrl(validation.redirectURI!, validation.tranCtx!);
  } catch (error) {
    const reason = error instanceof IciciUnsafeRedirectError ? error.message : 'unknown redirect validation error';
    await recordOutcomeSafely(deps, {
      merchantTxnNo,
      status: 'UNKNOWN',
      responseCode: rawResponseCode,
      rawInitiateResponse: { ...httpResult.body, _redirectValidationFailure: reason },
    });

    return {
      safeResult: {
        success: false,
        merchantTxnNo,
        message: 'The payment gateway returned an unexpected response. Please try again or contact support.',
      },
      preview,
      httpStatus: httpResult.httpStatus,
      rawResponseCode,
    };
  }

  // Initiation accepted — the CUSTOMER HAS NOT PAID YET. This only means
  // ICICI is ready to receive the customer on its hosted payment page.
  // A persistence failure here must never block a customer who already
  // has a validated redirect from a genuine ICICI acceptance — the
  // transaction record will simply be stale until reconciled (e.g. via
  // the return/callback route, which upserts by merchantTxnNo anyway).
  await recordOutcomeSafely(deps, {
    merchantTxnNo,
    status: 'INITIATED',
    responseCode: rawResponseCode,
    tranCtx: validation.tranCtx,
    rawInitiateResponse: httpResult.body,
  });

  return {
    safeResult: {
      success: true,
      merchantTxnNo,
      redirectURI: safeRedirectUrl,
      tranCtx: validation.tranCtx,
    },
    preview,
    httpStatus: httpResult.httpStatus,
    rawResponseCode,
  };
}
