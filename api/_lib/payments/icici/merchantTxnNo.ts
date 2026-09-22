/**
 * Server-side merchantTxnNo generation.
 *
 * Must be: unique, collision-resistant, reconciliation-friendly (sortable
 * by creation time), <=20 characters (bank-confirmed: longer values
 * suppress QR code generation — see crypto.ts), and never generated in
 * the browser (see docs/icici-orange-pg-integration.md §3).
 */

import { randomBytes } from 'node:crypto';
import { ICICI_MERCHANT_TXN_NO_MAX_LENGTH } from './crypto.js';

const PREFIX = 'PZ';
/** 4 random bytes -> 8 hex chars of collision resistance per merchantTxnNo. */
const RANDOM_SUFFIX_BYTES = 4;

/**
 * Generates a merchantTxnNo of the form `PZ<base36 timestamp><random hex>`.
 * The timestamp component keeps values roughly sortable/traceable back to
 * creation time for reconciliation; the random suffix makes two calls in
 * the same millisecond collision-resistant. Deterministic only in the
 * sense that its shape and length are guaranteed <=20 chars — `now` is
 * injectable for tests.
 */
export function generateIciciMerchantTxnNo(now: number = Date.now()): string {
  const timestampPart = now.toString(36).toUpperCase();
  const randomPart = randomBytes(RANDOM_SUFFIX_BYTES).toString('hex').toUpperCase();
  const merchantTxnNo = `${PREFIX}${timestampPart}${randomPart}`;

  if (merchantTxnNo.length > ICICI_MERCHANT_TXN_NO_MAX_LENGTH) {
    // Defensive only — with current constants this cannot happen for any
    // valid JS timestamp, but a shrinking margin over time is a real
    // failure mode for date-encoded IDs, so this is asserted rather than
    // silently truncated (truncation would risk collisions).
    throw new Error(
      `Generated merchantTxnNo "${merchantTxnNo}" exceeds ${ICICI_MERCHANT_TXN_NO_MAX_LENGTH} characters; ` +
        'the generation scheme needs revisiting before this can be sent to ICICI.',
    );
  }

  return merchantTxnNo;
}
