import { describe, it, expect } from 'vitest';
import { computeLeaveDays } from '@/lib/services/leave-calculation-service';
import { isWorkingDay } from '@/lib/services/working-day';
import { ValidationError } from '@/lib/errors';

describe('computeLeaveDays', () => {
  it('counts Friday through Monday as three work days (including Saturday)', () => {
    // 2026-07-24 is a Friday; 2026-07-27 is a Monday.
    expect(computeLeaveDays('2026-07-24', '2026-07-27')).toBe(3); // Fri + Sat + Mon
  });

  it.each([
    ['2026-07-27', true], // Monday
    ['2026-07-31', true], // Friday
    ['2026-07-25', true], // Saturday
    ['2026-07-26', false], // Sunday
  ])('uses the canonical Monday-Saturday work week for %s', (date, expected) => {
    expect(isWorkingDay(date)).toBe(expected);
  });

  it('excludes company holidays', () => {
    // Mon-Wed with Tuesday a holiday.
    const holidays = new Set(['2026-07-28']);
    expect(computeLeaveDays('2026-07-27', '2026-07-29', { holidays })).toBe(2);
  });

  it('is inclusive for a single weekday', () => {
    expect(computeLeaveDays('2026-07-27', '2026-07-27')).toBe(1);
  });

  it('counts a Saturday-only request as one day', () => {
    expect(computeLeaveDays('2026-07-25', '2026-07-25')).toBe(1);
  });

  it('returns 0 for a Sunday-only request', () => {
    expect(computeLeaveDays('2026-07-26', '2026-07-26')).toBe(0);
  });

  it('excludes Sunday from a multi-day request', () => {
    expect(computeLeaveDays('2026-07-25', '2026-07-27')).toBe(2); // Sat + Mon
  });

  it('excludes a Saturday listed in Holidays', () => {
    expect(computeLeaveDays('2026-07-25', '2026-07-25', {
      holidays: new Set(['2026-07-25']),
    })).toBe(0);
  });

  it('rejects end before start', () => {
    expect(() => computeLeaveDays('2026-07-27', '2026-07-25')).toThrow(ValidationError);
  });

  it('rejects malformed dates', () => {
    expect(() => computeLeaveDays('2026/07/27', '2026-07-28')).toThrow(ValidationError);
  });

  it('keeps the existing unsupported half-day policy unchanged, including Saturday', () => {
    expect(() => computeLeaveDays('2026-07-25', '2026-07-25', { halfDay: true })).toThrow(ValidationError);
    expect(() => computeLeaveDays('2026-07-27', '2026-07-27', { halfDay: true })).toThrow(ValidationError);
  });
});
