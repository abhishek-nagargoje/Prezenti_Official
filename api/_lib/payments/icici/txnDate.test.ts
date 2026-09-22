import { describe, expect, it } from 'vitest';
import { generateIciciTxnDate, parseIciciDateTime } from './txnDate';

describe('generateIciciTxnDate', () => {
  it('produces exactly 14 digits (yyyyMMddHHmmss)', () => {
    expect(generateIciciTxnDate()).toMatch(/^\d{14}$/);
  });

  it('converts a known UTC instant to Asia/Kolkata (UTC+5:30) correctly', () => {
    // 2024-11-21T06:24:13Z == 2024-11-21T11:54:13+05:30
    const utc = new Date('2024-11-21T06:24:13.000Z');
    expect(generateIciciTxnDate(utc)).toBe('20241121115413');
  });

  it('rolls over to the next day near IST midnight', () => {
    // 2024-01-01T18:35:00Z == 2024-01-02T00:05:00+05:30
    const utc = new Date('2024-01-01T18:35:00.000Z');
    expect(generateIciciTxnDate(utc)).toBe('20240102000500');
  });

  it('is deterministic for a fixed input', () => {
    const fixed = new Date('2024-06-15T10:00:00.000Z');
    expect(generateIciciTxnDate(fixed)).toBe(generateIciciTxnDate(fixed));
  });
});

describe('parseIciciDateTime', () => {
  it('parses the documented sample paymentDateTime into an ISO string with the +05:30 offset', () => {
    expect(parseIciciDateTime('20241121115413')).toBe('2024-11-21T11:54:13+05:30');
  });

  it('round-trips with generateIciciTxnDate for the same instant', () => {
    const utc = new Date('2024-11-21T06:24:13.000Z');
    const generated = generateIciciTxnDate(utc);
    expect(parseIciciDateTime(generated)).toBe('2024-11-21T11:54:13+05:30');
  });

  it('returns undefined for undefined input', () => {
    expect(parseIciciDateTime(undefined)).toBeUndefined();
  });

  it('returns undefined for a malformed value rather than guessing', () => {
    expect(parseIciciDateTime('not-a-date')).toBeUndefined();
    expect(parseIciciDateTime('2024112111541')).toBeUndefined(); // 13 digits
    expect(parseIciciDateTime('')).toBeUndefined();
  });
});
