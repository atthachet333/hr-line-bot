import { describe, it, expect } from 'vitest';
import {
  formatThaiDate,
  formatThaiDateRange,
  formatThaiDateTime,
  parseSheetDate,
  sheetDateToYmd,
} from '@/lib/utils/datetime';

describe('formatThaiDate', () => {
  it('formats a YYYY-MM-DD date with the Buddhist year', () => {
    expect(formatThaiDate('2026-08-10')).toBe('10 สิงหาคม 2569');
  });

  it('does not shift across the UTC boundary', () => {
    // Bangkok is UTC+7; a naive new Date("2026-01-01") would roll back a day.
    expect(formatThaiDate('2026-01-01')).toBe('1 มกราคม 2569');
  });

  it('returns "-" for an invalid value (never a garbage year)', () => {
    expect(formatThaiDate('not-a-date')).toBe('-');
    expect(formatThaiDate('')).toBe('-');
  });

  it('formats a Google Sheets serial number correctly', () => {
    // 44197 is the well-known serial for 2021-01-01.
    expect(formatThaiDate(44197)).toBe('1 มกราคม 2564');
    // The reported bug value (46787) is a real 2028 date, NOT year 46787.
    expect(formatThaiDate('46787')).not.toContain('46787');
    expect(formatThaiDate('46787')).toBe('4 กุมภาพันธ์ 2571');
  });
});

describe('parseSheetDate / sheetDateToYmd', () => {
  it('parses YYYY-MM-DD', () => {
    expect(sheetDateToYmd('2026-08-06')).toBe('2026-08-06');
  });

  it('parses a Google serial (number and numeric string)', () => {
    expect(sheetDateToYmd(44197)).toBe('2021-01-01');
    expect(sheetDateToYmd('44197')).toBe('2021-01-01');
  });

  it('takes the calendar-date part of a YYYY-MM-DD(T…) value', () => {
    expect(sheetDateToYmd('2026-08-06T19:00:00.000Z')).toBe('2026-08-06');
  });

  it('parses a Thai formatted date (Buddhist year)', () => {
    expect(sheetDateToYmd('10 สิงหาคม 2569')).toBe('2026-08-10');
  });

  it('returns null / "" for invalid or non-date numbers', () => {
    expect(parseSheetDate('nope')).toBeNull();
    expect(parseSheetDate(2)).toBeNull(); // a totalDays count, not a date
    expect(sheetDateToYmd('')).toBe('');
  });
});

describe('formatThaiDateRange', () => {
  it('collapses a same-month range', () => {
    expect(formatThaiDateRange('2026-08-10', '2026-08-11')).toBe('10–11 สิงหาคม 2569');
  });

  it('shows both endpoints across month boundaries', () => {
    expect(formatThaiDateRange('2026-08-30', '2026-09-02')).toBe(
      '30 สิงหาคม 2569 – 2 กันยายน 2569',
    );
  });

  it('shows a single date when start equals end', () => {
    expect(formatThaiDateRange('2026-08-10', '2026-08-10')).toBe('10 สิงหาคม 2569');
  });
});

describe('formatThaiDateTime', () => {
  it('renders date + time in Asia/Bangkok', () => {
    // 03:30 UTC -> 10:30 Bangkok.
    const out = formatThaiDateTime('2026-08-03T03:30:00.000Z');
    expect(out).toContain('3 สิงหาคม 2569');
    expect(out).toContain('10:30');
    expect(out).toContain('น.');
  });
});
