/**
 * ICICI Command endpoint — Transaction STATUS check.
 *
 * SOURCE: rewritten against the actual official ICICI document
 * ("Gateway_Interface_Specifiation_V0.4_Orange_PG"), read in full,
 * Chapter 12 ("Transaction Status") + its worked curl sample. This
 * resolves what was previously a deliberate fail-closed gap.
 *
 * CONFIRMED:
 * - Endpoint: `https://pgpayuat.icicibank.com/tsp/pg/api/command` (UAT),
 *   `https://pgpay.icicibank.com/pg/api/command` (production — not used
 *   by this integration).
 * - Transport: server-to-server POST, `application/x-www-form-urlencoded`
 *   (doc: "This is a server-to-server API Call which uses POST method
 *   with content type as 'application/x-www-form-urlencoded'.").
 * - Request fields (Chapter 12.1 table + the worked curl sample, which
 *   additionally shows `addlParam1` participating despite not being on
 *   the published table — confirming the doc's general Note 1 applies
 *   here too): merchantID, aggregatorID (conditional), merchantTxnNo,
 *   originalTxnNo, transactionType ("STATUS"), oth_charge (conditional),
 *   addlParam1 (seen in the sample, not the table), secureHash.
 * - Hash: ICICI Hash Calculation V1 — the SAME generic algorithm as
 *   Initiate Sale and the return/callback (see crypto.ts), NOT a
 *   distinct STATUS-specific formula. No hash "version" is specified for
 *   this API, and the doc's Note 2 states V1 applies whenever a version
 *   isn't specified. `generateIciciStatusHash` below is no longer a
 *   guess — it is the same confirmed primitive, applied to the STATUS
 *   request's own (different) field set.
 * - Response fields (Chapter 12.2 table + the worked JSON sample):
 *   responseCode, respDescription, merchantId, aggregatorID,
 *   merchantTxnNo, txnStatus (REQ/SUC/REJ/ERR — see responseCodes.ts),
 *   txnResponseCode, txnRespDescription, txnID, paymentDateTime,
 *   txnAuthID, secureHash — plus additional fields observed in the
 *   worked sample not on the published table (amount, authCode,
 *   paymentMode, customerEmailID, TransmissionDateTime, oth_charge,
 *   paymentInstId, customerMobileNo), consistent with Note 1.
 */

import { generateIciciHashV1, verifyIciciHashV1 } from './crypto';
import { postIciciCommand, IciciRequestTimeoutError } from './httpClient';
import { mapIciciTxnStatusToInternalStatus, type IciciInternalTransactionStatus } from './responseCodes';
import type { IciciConfig } from './env';

export interface IciciStatusCheckRequestFields {
  merchantId: string;
  merchantTxnNo: string;
  /** The merchantTxnNo of the original Initiate Sale this STATUS check is reconciling. */
  originalTxnNo: string;
  transactionType: 'STATUS';
  aggregatorID?: string;
  oth_charge?: string;
  addlParam1?: string;
}

/** Shape only for the fields Prezenti's business logic reads — hash verification (below) operates on the raw received object, per doc Note 1. */
export interface IciciStatusCheckResponse {
  responseCode?: string;
  respDescription?: string;
  merchantId?: string;
  aggregatorID?: string;
  merchantTxnNo?: string;
  txnStatus?: string;
  txnResponseCode?: string;
  txnRespDescription?: string;
  txnID?: string;
  paymentDateTime?: string;
  txnAuthID?: string;
  amount?: string;
  secureHash?: string;
}

/**
 * Builds the STATUS request's secureHash input (ICICI Hash Calculation
 * V1: ascending parameter-name order, non-empty fields only, no
 * delimiter). Callers must pass the exact field set actually being
 * transmitted — including any additional fields beyond
 * `IciciStatusCheckRequestFields`, per the doc's Note 1.
 */
export function generateIciciStatusHash(fields: IciciStatusCheckRequestFields, hashKey: string): string {
  return generateIciciHashV1(fields as unknown as Record<string, string>, hashKey);
}

/**
 * Verifies the secureHash on a STATUS response using the same ICICI
 * Hash Calculation V1 primitive (this API's response hash is not
 * distinct from the request hash mechanism — both use V1). `rawResponse`
 * must be the exact parsed response body fields.
 */
export function verifyIciciStatusResponseHash(rawResponse: Record<string, string>, hashKey: string): boolean {
  return verifyIciciHashV1(rawResponse, hashKey);
}

/**
 * Builds the full STATUS request body (fields + secureHash) ready to
 * POST as `application/x-www-form-urlencoded`. `hashKey` is used only to
 * compute the hash and is never included in the returned object.
 */
export function buildIciciStatusRequestBody(
  fields: IciciStatusCheckRequestFields,
  hashKey: string,
): Record<string, string> {
  const secureHash = generateIciciStatusHash(fields, hashKey);
  const body: Record<string, string> = { transactionType: fields.transactionType };
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') body[key] = value;
  }
  body.secureHash = secureHash;
  return body;
}

export type IciciStatusCheckOutcome =
  | 'REJECTED_HTTP_ERROR'
  | 'REJECTED_MALFORMED_RESPONSE'
  | 'REJECTED_HASH_MISMATCH'
  | 'TIMEOUT'
  | 'VERIFIED';

export interface IciciStatusCheckResult {
  outcome: IciciStatusCheckOutcome;
  /** Only ever non-UNKNOWN when outcome is VERIFIED — a hash-unverified response is never trusted. */
  status: IciciInternalTransactionStatus;
  merchantTxnNo?: string;
  txnResponseCode?: string;
  txnID?: string;
  httpStatus?: number;
}

/**
 * Performs one STATUS check call against the ICICI Command endpoint and
 * returns a safe, verified-or-rejected result. Never persists anything —
 * that's the caller's responsibility, same split as initiateSaleService.
 * A network timeout does NOT retry automatically (per policy) — it
 * surfaces as outcome `TIMEOUT` so the caller can mark the transaction
 * PENDING/UNKNOWN and reconcile later rather than assume failure.
 */
export async function checkIciciTransactionStatus(
  originalTxnNo: string,
  merchantTxnNo: string,
  config: Pick<IciciConfig, 'merchantId' | 'aggregatorId' | 'hashKey' | 'commandUrl'>,
  fetchImpl?: typeof fetch,
): Promise<IciciStatusCheckResult> {
  const fields: IciciStatusCheckRequestFields = {
    merchantId: config.merchantId,
    aggregatorID: config.aggregatorId,
    merchantTxnNo,
    originalTxnNo,
    transactionType: 'STATUS',
  };

  const requestBody = buildIciciStatusRequestBody(fields, config.hashKey);

  let httpResult;
  try {
    httpResult = await postIciciCommand(config.commandUrl, requestBody, fetchImpl);
  } catch (error) {
    if (error instanceof IciciRequestTimeoutError) {
      return { outcome: 'TIMEOUT', status: 'UNKNOWN', merchantTxnNo };
    }
    throw error;
  }

  if (!httpResult.body) {
    return { outcome: 'REJECTED_MALFORMED_RESPONSE', status: 'UNKNOWN', merchantTxnNo, httpStatus: httpResult.httpStatus };
  }

  if (httpResult.httpStatus < 200 || httpResult.httpStatus >= 300) {
    return { outcome: 'REJECTED_HTTP_ERROR', status: 'UNKNOWN', merchantTxnNo, httpStatus: httpResult.httpStatus };
  }

  const rawResponse: Record<string, string> = {};
  for (const [key, value] of Object.entries(httpResult.body)) {
    if (typeof value === 'string') rawResponse[key] = value;
  }

  if (!verifyIciciStatusResponseHash(rawResponse, config.hashKey)) {
    return { outcome: 'REJECTED_HASH_MISMATCH', status: 'UNKNOWN', merchantTxnNo, httpStatus: httpResult.httpStatus };
  }

  const txnStatus = httpResult.body.txnStatus as string | undefined;

  return {
    outcome: 'VERIFIED',
    status: mapIciciTxnStatusToInternalStatus(txnStatus ?? ''),
    merchantTxnNo: httpResult.body.merchantTxnNo ?? merchantTxnNo,
    txnResponseCode: httpResult.body.txnResponseCode,
    txnID: httpResult.body.txnID,
    httpStatus: httpResult.httpStatus,
  };
}
