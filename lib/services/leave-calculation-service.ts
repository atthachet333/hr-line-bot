import { ValidationError } from '@/lib/errors';
import { isWorkingDay } from '@/lib/services/working-day';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface LeaveCalcOptions {
  /** Company holidays as YYYY-MM-DD strings (never counted). */
  holidays?: Set<string>;
  /** Half-day support is not implemented; reject if requested. */
  halfDay?: boolean;
}

/** Format a UTC-based date as YYYY-MM-DD (dates are timezone-agnostic here). */
function toYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Compute the number of leave days for an inclusive [startDate, endDate] range.
 *
 * Rules:
 *  - Dates must be YYYY-MM-DD; parsed as UTC to avoid TZ drift.
 *  - startDate must not be after endDate.
 *  - Inclusive of both endpoints.
 *  - Monday-Saturday are working days; Sunday is excluded.
 *  - Company holidays always excluded.
 *  - Result is >= 0; if every day is excluded, result is 0.
 *  - Half-day is explicitly rejected (not supported this round).
 *
 * Throws ValidationError on bad input.
 */
export function computeLeaveDays(
  startDate: string,
  endDate: string,
  opts: LeaveCalcOptions = {},
): number {
  if (opts.halfDay) {
    throw new ValidationError('ระบบยังไม่รองรับการลาแบบครึ่งวัน');
  }
  if (!DATE_RE.test(startDate)) throw new ValidationError('วันที่เริ่มลาไม่ถูกต้อง');
  if (!DATE_RE.test(endDate)) throw new ValidationError('วันที่สิ้นสุดไม่ถูกต้อง');

  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new ValidationError('ไม่สามารถอ่านวันที่ได้');
  }
  if (start > end) {
    throw new ValidationError('วันที่สิ้นสุดต้องไม่อยู่ก่อนวันที่เริ่มลา');
  }

  const holidays = opts.holidays ?? new Set<string>();

  let count = 0;
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const date = toYmd(ms);
    if (!isWorkingDay(date)) continue;
    if (holidays.has(date)) continue;
    count += 1;
  }
  return count;
}
