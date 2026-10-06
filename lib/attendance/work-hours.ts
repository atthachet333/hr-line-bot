/** Canonical unpaid break window for daily employees (local business time). */
export const DAILY_BREAK_START_TIME = '12:00';
export const DAILY_BREAK_END_TIME = '13:00';

function timeToMinutes(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 + minutes + seconds / 60;
}

const BREAK_START_MINUTES = timeToMinutes(DAILY_BREAK_START_TIME) as number;
const BREAK_END_MINUTES = timeToMinutes(DAILY_BREAK_END_TIME) as number;

/**
 * Calculate one session's paid hours. Daily employees lose only the part of
 * this session that actually overlaps the canonical break window. Splitting a
 * day around the break therefore cannot deduct that break a second time.
 */
export function calculateSessionWorkHours(
  checkin: unknown,
  checkout: unknown,
  deductDailyBreak: boolean,
): number | null {
  const start = timeToMinutes(checkin);
  const end = timeToMinutes(checkout);
  if (start === null || end === null || end < start) return null;

  const rawMinutes = end - start;
  const breakOverlapMinutes = deductDailyBreak
    ? Math.max(0, Math.min(end, BREAK_END_MINUTES) - Math.max(start, BREAK_START_MINUTES))
    : 0;
  return Number(((rawMinutes - breakOverlapMinutes) / 60).toFixed(4));
}
