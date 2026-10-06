const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Company work week is Monday-Saturday. Sunday (UTC day 0) is always off. */
export const WORKING_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6]);

/** Dates are parsed at UTC midnight so a YYYY-MM-DD business date cannot drift. */
export function isWorkingDay(date: string | Date): boolean {
  const value = typeof date === 'string'
    ? (DATE_RE.test(date) ? new Date(`${date}T00:00:00Z`) : null)
    : date;
  return value instanceof Date
    && !Number.isNaN(value.getTime())
    && WORKING_WEEKDAYS.has(value.getUTCDay());
}
