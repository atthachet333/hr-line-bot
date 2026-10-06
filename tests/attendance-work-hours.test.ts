import { describe, expect, it } from 'vitest';
import {
  DAILY_BREAK_END_TIME,
  DAILY_BREAK_START_TIME,
  calculateSessionWorkHours,
} from '@/lib/attendance/work-hours';

describe('daily employee session work hours', () => {
  it('keeps the canonical break window in one shared helper', () => {
    expect([DAILY_BREAK_START_TIME, DAILY_BREAK_END_TIME]).toEqual(['12:00', '13:00']);
  });

  it.each([
    ['10:00', '17:00', 6],
    ['13:00', '17:00', 4],
    ['10:00', '12:30', 2],
    ['08:00', '11:00', 3],
  ])('calculates %s-%s with only actual break overlap deducted', (start, end, expected) => {
    expect(calculateSessionWorkHours(start, end, true)).toBe(expected);
  });

  it('does not double-deduct when sessions split around lunch', () => {
    const morning = calculateSessionWorkHours('10:00', '12:00', true) ?? 0;
    const afternoon = calculateSessionWorkHours('13:00', '17:00', true) ?? 0;
    expect(morning + afternoon).toBe(6);
  });

  it('retains raw-duration behavior when daily break policy is not selected', () => {
    expect(calculateSessionWorkHours('08:30', '17:45', false)).toBe(9.25);
  });
});
