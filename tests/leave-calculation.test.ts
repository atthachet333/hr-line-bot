import { describe, it, expect } from 'vitest';
import { computeLeaveDays } from '@/lib/services/leave-calculation-service';
import { ValidationError } from '@/lib/errors';

describe('computeLeaveDays', () => {
  it('counts inclusive weekdays, excluding weekends by default', () => {
    // 2026-07-24 is a Friday; 2026-07-27 is a Monday.
    expect(computeLeaveDays('2026-07-24', '2026-07-27')).toBe(2); // Fri + Mon
  });

  it('counts weekends when configured', () => {
    expect(computeLeaveDays('2026-07-24', '2026-07-27', { countWeekends: true })).toBe(4);
  });

  it('excludes company holidays', () => {
    // Mon-Wed with Tuesday a holiday.
    const holidays = new Set(['2026-07-28']);
    expect(computeLeaveDays('2026-07-27', '2026-07-29', { holidays })).toBe(2);
  });

  it('is inclusive for a single weekday', () => {
    expect(computeLeaveDays('2026-07-27', '2026-07-27')).toBe(1);
  });

  it('returns 0 when the whole range is weekend', () => {
    // 2026-07-25 Sat, 2026-07-26 Sun.
    expect(computeLeaveDays('2026-07-25', '2026-07-26')).toBe(0);
  });

  it('rejects end before start', () => {
    expect(() => computeLeaveDays('2026-07-27', '2026-07-25')).toThrow(ValidationError);
  });

  it('rejects malformed dates', () => {
    expect(() => computeLeaveDays('2026/07/27', '2026-07-28')).toThrow(ValidationError);
  });

  it('rejects half-day requests', () => {
    expect(() => computeLeaveDays('2026-07-27', '2026-07-27', { halfDay: true })).toThrow(ValidationError);
  });
});
