/**
 * ICICI Orange PG transaction response-code interpretation.
 *
 * IMPORTANT CORRECTION: this module originally contained a granular code
 * table (0000/0015/0017/0392/0395/0396/0397/0399) attributed to "the
 * supplied ICICI documentation." Having since read the actual official
 * document in full ("Gateway_Interface_Specifiation_V0.4_Orange_PG",
 * all 76 pages) directly, **none of those specific codes appear anywhere
 * in it.** That table's original source is unknown — it was never
 * verified against a primary source, only asserted. It is kept below,
 * renamed and clearly marked UNCONFIRMED, for reference only — it is NOT
 * used by any trusted code path.
 *
 * What the actual document DOES establish, for the Payment Response /
 * Authorization Redirect Response (the return/callback leg) and for
 * Refund/Auth/Void and Authorize responses, is a simple three-way rule
 * (doc Chapter 6/7 "responseCode" remarks): **"000" and "0000" = Success;
 * "R1000" = Request Initiated successfully (used for out-of-band flows
 * such as UPI — the payment has NOT concluded yet); any other value
 * indicates failure.** This is the mapping this module now actually
 * implements and that callback.ts uses.
 *
 * The Transaction STATUS command (Chapter 12) uses a SEPARATE, distinct
 * enum for `txnStatus`: REQ (received/in process), SUC (successful), REJ
 * (rejected), ERR (error) — plus its own `txnResponseCode` following the
 * same 000/0000-success rule. See `mapIciciTxnStatusToInternalStatus`.
 */

/** Normalized internal transaction lifecycle states (see docs/icici-orange-pg-integration.md §7). */
export type IciciInternalTransactionStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN';

/** Confirmed by the official doc: Initiate Sale / Authorize / Payment Response "out-of-band initiated" code. */
export const ICICI_INITIATED_OUT_OF_BAND_CODE = 'R1000';

/**
 * Maps a Payment Response / Authorize / Refund `responseCode` to
 * Prezenti's internal state, per the confirmed document rule: "000"/
 * "0000" = success; "R1000" = initiated only (out-of-band, e.g. UPI —
 * NOT a completed payment); anything else = failure. Never returns
 * SUCCESS for any code other than an exact "000"/"0000" match.
 */
export function mapIciciPaymentResponseCode(responseCode: string): IciciInternalTransactionStatus {
  if (responseCode === '000' || responseCode === '0000') return 'SUCCESS';
  if (responseCode === ICICI_INITIATED_OUT_OF_BAND_CODE) return 'PENDING';
  return 'FAILED';
}

/** Confirmed Transaction STATUS command `txnStatus` enum (doc Chapter 12.2). */
export type IciciTxnStatus = 'REQ' | 'SUC' | 'REJ' | 'ERR';

/**
 * Maps the Transaction STATUS command's `txnStatus` + `txnResponseCode`
 * to Prezenti's internal state. `txnStatus` is the authoritative signal
 * per the doc ("For status of the original txn always check txnStatus
 * and txnResponseCode"); an unrecognized `txnStatus` value maps to
 * UNKNOWN rather than being guessed.
 */
export function mapIciciTxnStatusToInternalStatus(txnStatus: string): IciciInternalTransactionStatus {
  switch (txnStatus as IciciTxnStatus) {
    case 'SUC':
      return 'SUCCESS';
    case 'REJ':
      return 'FAILED';
    case 'ERR':
      return 'FAILED';
    case 'REQ':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}

/** Confirmed Settlement Status enum (doc Chapter 13.2): NSD = not yet settled, STD = settled. Reconciliation-only, not part of the payment-success state machine. */
export type IciciSettlementStatus = 'NSD' | 'STD';

// ---------------------------------------------------------------------------
// UNCONFIRMED legacy table — kept for reference only. Not used by any
// trusted code path. See module doc above for why.
// ---------------------------------------------------------------------------

export interface IciciResponseCodeEntry {
  /** The bank's own description, preserved verbatim — never rewritten. */
  description: string;
  /** The internal-state mapping this table previously asserted for this code. */
  internalStatus: IciciInternalTransactionStatus;
  mappingNote?: string;
}

/**
 * @deprecated UNCONFIRMED — this table's source was never verified. It
 * does NOT appear in the official Gateway Interface Specification V0.4
 * PDF (checked directly, in full). Do not wire this into any trusted
 * status-mapping path; use `mapIciciPaymentResponseCode` or
 * `mapIciciTxnStatusToInternalStatus` instead.
 */
export const ICICI_RESPONSE_CODES_UNCONFIRMED: Readonly<Record<string, IciciResponseCodeEntry>> = {
  '0000': { description: 'successful', internalStatus: 'SUCCESS' },
  '0015': { description: 'expired', internalStatus: 'EXPIRED' },
  '0017': { description: 'customer cancel', internalStatus: 'CANCELLED' },
  '0392': { description: 'cancelled by user', internalStatus: 'CANCELLED' },
  '0395': { description: 'user aborted', internalStatus: 'CANCELLED' },
  '0396': { description: 'awaited', internalStatus: 'PENDING' },
  '0397': { description: 'aborted', internalStatus: 'FAILED' },
  '0399': { description: 'failed', internalStatus: 'FAILED' },
};
