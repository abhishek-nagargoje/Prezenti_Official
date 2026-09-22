/**
 * Server-side txnDate generation: yyyyMMddHHmmss (confirmed format —
 * verified against the documented hash example, e.g. "20241121115413").
 *
 * Timezone: Asia/Kolkata (IST). The bank documentation confirms the
 * *format* but not explicitly the timezone; IST is used here as a
 * deliberate, documented choice (ICICI is an Indian bank and this field
 * is otherwise ambiguous — see docs/icici-orange-pg-integration.md §3),
 * not a cryptographic guess — unlike the hash formula itself, getting
 * this wrong does not break signature verification, only
 * reconciliation-by-eye. Revisit if the bank ever states a different
 * timezone expectation.
 */

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

/** Generates txnDate in yyyyMMddHHmmss format, in Asia/Kolkata time. `now` is injectable for tests. */
export function generateIciciTxnDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour') === '24' ? '00' : get('hour');
  const minute = get('minute');
  const second = get('second');

  return `${pad(Number(year), 4)}${pad(Number(month), 2)}${pad(Number(day), 2)}${pad(Number(hour), 2)}${pad(Number(minute), 2)}${pad(Number(second), 2)}`;
}

/**
 * Parses a bank-supplied `yyyyMMddHHmmss` value (e.g. `paymentDateTime`
 * in a return/callback or STATUS response) into an ISO 8601 string with
 * the Asia/Kolkata (+05:30) offset, for storage in a `timestamptz`
 * column. Same documented-format-but-undocumented-timezone reasoning as
 * `generateIciciTxnDate` above applies here. Returns `undefined` for a
 * value that doesn't match the expected 14-digit shape, rather than
 * guessing.
 */
export function parseIciciDateTime(value: string | undefined): string | undefined {
  if (!value || !/^\d{14}$/.test(value)) return undefined;

  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(8, 10);
  const minute = value.slice(10, 12);
  const second = value.slice(12, 14);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`;
}
