/**
 * Builds a safe, human-reviewable preview of an Initiate Sale request
 * before it is ever sent — no hash key, no full customer PII, and the
 * preview is explicitly proven (by test) not to contain the hash key
 * substring anywhere in its serialized form.
 */

import type { IciciInitiateSaleRequestBody } from './requestBuilder';

export interface IciciInitiateSalePreview {
  endpoint: string;
  httpMethod: 'POST';
  contentType: 'application/json';
  requestFieldNames: string[];
  amount: string;
  currencyCode: string;
  merchantTxnNo: string;
  txnDate: string;
  returnURL: string;
  /** Hash input with customer-identifying values (email, mobile, name) replaced by their lengths only. */
  redactedHashInputPreview: string;
  secureHash: string;
  hashKeyIncluded: false;
}

function redactValue(value: string): string {
  return value.length > 0 ? `<redacted:${value.length}chars>` : '<empty>';
}

/**
 * Builds the preview object described in the pre-flight report
 * requirements. `requestBody` must already have secureHash computed;
 * this function never touches the hash key.
 */
export function buildIciciInitiateSalePreview(
  requestBody: IciciInitiateSaleRequestBody,
  endpoint: string,
): IciciInitiateSalePreview {
  const redactedHashInputPreview = [
    requestBody.merchantId,
    requestBody.aggregatorID,
    requestBody.merchantTxnNo,
    requestBody.amount,
    requestBody.currencyCode,
    requestBody.payType,
    redactValue(requestBody.customerEmailID),
    requestBody.transactionType,
    requestBody.returnURL,
    requestBody.txnDate,
    redactValue(requestBody.customerMobileNo),
    redactValue(requestBody.customerName),
    requestBody.addlParam1,
    requestBody.addlParam2,
  ].join('');

  return {
    endpoint,
    httpMethod: 'POST',
    contentType: 'application/json',
    requestFieldNames: Object.keys(requestBody),
    amount: requestBody.amount,
    currencyCode: requestBody.currencyCode,
    merchantTxnNo: requestBody.merchantTxnNo,
    txnDate: requestBody.txnDate,
    returnURL: requestBody.returnURL,
    redactedHashInputPreview,
    secureHash: requestBody.secureHash,
    hashKeyIncluded: false,
  };
}
