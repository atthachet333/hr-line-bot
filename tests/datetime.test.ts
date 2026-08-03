import { describe, it, expect } from 'vitest';
import {
  formatThaiDate,
  formatThaiDateRange,
  formatThaiDateTime,
} from '@/lib/utils/datetime';

describe('formatThaiDate', () => {
  it('formats a YYYY-MM-DD date with the Buddhist year', () => {
    expect(formatThaiDate('2026-08-10')).toBe('10 สิงหาคม 2569');
  });

  it('does not shift across the UTC boundary', () => {
    // Bangkok is UTC+7; a naive new Date("2026-01-01") would roll back a day.
    expect(formatThaiDate('2026-01-01')).toBe('1 มกราคม 2569');
  });

  it('returns the input unchanged when invalid', () => {
    expect(formatThaiDate('not-a-date')).toBe('not-a-date');
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
