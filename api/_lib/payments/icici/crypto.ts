/**
 * ICICI Bank Orange PG — cryptographic utilities.
 *
 * Server-side only. This module never reads environment variables itself
 * — callers pass the hash key in explicitly, and it is never logged,
 * returned, or persisted anywhere in this module.
 *
 * SOURCE: this module was rewritten against the actual official ICICI
 * document ("Gateway_Interface_Specifiation_V0.4_Orange_PG"), read in
 * full (all 76 pages), not a paraphrase. Two things changed as a result
 * of reading the primary source directly — noted here so the history is
 * traceable:
 *
 * 1. **Hash Calculation V1 is a single, generic, documented algorithm**
 *    (doc page "Hash Calculation"), used by every form-urlencoded/legacy
 *    API where a hash "version" isn't separately specified (Initiate
 *    Sale, Payment Response/return, Refund/Auth/Void, Transaction
 *    Status, Settlement Status/Summary) — confirmed by the doc's own
 *    "Note 2": *"The hash calculation logic is available in V1 and V2.
 *    For APIs where the version is not specified, it is assumed to be
 *    Hash Calc V1."* The rule: concatenate the VALUES of all non-null,
 *    non-empty parameters (the secureHash field itself excluded), sorted
 *    in **ascending order of parameter name**, no delimiter, no field
 *    names, then HMAC-SHA256 → hex → lowercase. This is a single generic
 *    primitive (`generateIciciHashV1`/`buildIciciHashV1Input` below),
 *    not a per-endpoint field-order table — a prior pass in this file's
 *    history hardcoded a 14-field alphabetical array specific to
 *    Initiate Sale; that hardcoded order was verified byte-for-byte
 *    identical to what the generic sort produces for that field set (JS's
 *    default string sort matches "ascending by parameter name" for these
 *    field names), so nothing observable changes for Initiate Sale, but
 *    the implementation is now the actual general-purpose algorithm,
 *    reusable for the return/callback and STATUS hashes.
 *    **The doc's own Note 1 says even parameters absent from the
 *    published field table must still participate in the hash if
 *    they're actually present and non-empty** — so callers must pass
 *    the *entire* received/sent parameter set, not just the fields this
 *    module happens to have typed interfaces for.
 *
 * 2. **The HMAC message bytes are ASCII, not UTF-8.** The doc's own Java
 *    example computes `mac.doFinal(msg.getBytes("ASCII"))` — the KEY is
 *    UTF-8 (`keyString.getBytes("UTF-8")`), confirmed as before, but the
 *    message being hashed is explicitly encoded as ASCII. An earlier
 *    pass of this module used UTF-8 for the message too, which was a
 *    real (if likely rarely-observable, since almost all field values in
 *    this integration are plain ASCII) discrepancy from the bank's own
 *    reference implementation. Fixed here.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Bank-confirmed cap: merchantTxnNo values over this length suppress QR code generation. */
export const ICICI_MERCHANT_TXN_NO_MAX_LENGTH = 20;

export class IciciHashInputError extends Error {}

function assertValidMerchantTxnNo(merchantTxnNo: string): void {
  if (merchantTxnNo.length > ICICI_MERCHANT_TXN_NO_MAX_LENGTH) {
    throw new IciciHashInputError(
      `merchantTxnNo must be at most ${ICICI_MERCHANT_TXN_NO_MAX_LENGTH} characters ` +
        `(bank-confirmed: longer values suppress QR code generation); received ${merchantTxnNo.length} characters.`,
    );
  }
}

/**
 * Shared HMAC-SHA256 primitive, matching the bank's Java reference
 * implementation exactly: key bytes are UTF-8, message bytes are ASCII,
 * digest is rendered as lowercase hex. Pure and deterministic — no I/O,
 * no logging of `hashKey` or `input`.
 */
export function computeIciciHmacSha256Hex(input: string, hashKey: string): string {
  return createHmac('sha256', Buffer.from(hashKey, 'utf8')).update(input, 'ascii').digest('hex');
}

/**
 * ICICI Hash Calculation V1 (the documented, generic algorithm — see
 * module doc above). `params` should be the exact parameter set actually
 * being sent/received (every real field, published or not) as plain
 * string values; `null`/`undefined`/`""` entries are excluded, per the
 * documented rule ("ignore only those parameters which are null or have
 * empty values"). The `secureHash` field itself must not be included by
 * the caller — this function does not special-case any key name, so it
 * hashes exactly the object it's given.
 */
export function buildIciciHashV1Input(params: Record<string, string | null | undefined>): string {
  const sortedNames = Object.keys(params)
    .filter((name) => params[name] !== null && params[name] !== undefined && params[name] !== '')
    .sort();

  return sortedNames.map((name) => params[name] as string).join('');
}

/** Computes an ICICI Hash Calculation V1 secureHash for the given parameter set. See `buildIciciHashV1Input`. */
export function generateIciciHashV1(params: Record<string, string | null | undefined>, hashKey: string): string {
  return computeIciciHmacSha256Hex(buildIciciHashV1Input(params), hashKey);
}

/**
 * Verifies a received `secureHash` value against ICICI Hash Calculation
 * V1 computed over `rawParams` (every non-empty field actually present,
 * `secureHash` itself excluded — do not pre-filter to a known field set,
 * per the doc's Note 1). Uses a constant-time comparison. Shared by both
 * the Payment Response/callback and the STATUS response, which use the
 * identical V1 mechanism.
 */
export function verifyIciciHashV1(rawParams: Record<string, string>, hashKey: string): boolean {
  const receivedHash = rawParams.secureHash;
  if (!receivedHash) return false;

  const fieldsToHash: Record<string, string> = { ...rawParams };
  delete fieldsToHash.secureHash;
  const expectedHash = generateIciciHashV1(fieldsToHash, hashKey);

  const receivedBuf = Buffer.from(receivedHash.toLowerCase(), 'utf8');
  const expectedBuf = Buffer.from(expectedHash, 'utf8');
  if (receivedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(receivedBuf, expectedBuf);
}

/** JSON request body field names for Direct Orange PG Initiate Sale (order here is cosmetic — JSON object order is not semantic). */
export interface IciciDirectOrangeInitiateSaleFields {
  merchantId: string;
  aggregatorID: string;
  merchantTxnNo: string;
  amount: string;
  currencyCode: string;
  payType: string;
  customerEmailID: string;
  transactionType: string;
  returnURL: string;
  txnDate: string;
  customerMobileNo: string;
  customerName: string;
  addlParam1: string;
  addlParam2: string;
}

/**
 * Builds the Direct Orange PG Initiate Sale secureHash input: field
 * values concatenated per Hash Calculation V1 (ascending parameter name
 * order), no delimiter, no field names. Values must be exactly what is
 * transmitted in the JSON request body — this function performs no
 * reformatting. A typed convenience wrapper over the generic
 * `buildIciciHashV1Input` for Initiate Sale's known field set.
 */
export function buildIciciDirectOrangeInitiateSaleHashInput(fields: IciciDirectOrangeInitiateSaleFields): string {
  assertValidMerchantTxnNo(fields.merchantTxnNo);
  return buildIciciHashV1Input(fields as unknown as Record<string, string>);
}

/**
 * Computes the Direct Orange PG Initiate Sale secureHash: Hash
 * Calculation V1 over the request fields. This is the function to use
 * for Prezenti's real Initiate Sale requests. `hashKey` must never be
 * logged, hardcoded, or exposed to frontend code.
 */
export function generateIciciDirectOrangeInitiateSaleHash(
  fields: IciciDirectOrangeInitiateSaleFields,
  hashKey: string,
): string {
  assertValidMerchantTxnNo(fields.merchantTxnNo);
  return generateIciciHashV1(fields as unknown as Record<string, string>, hashKey);
}
