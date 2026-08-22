/**
 * Pure attendance rules — no I/O, no Sheets, no dates-from-now. This is the
 * single source of truth for how check-in / check-out are matched, so the
 * behaviour is unit-testable in isolation.
 *
 * Identity is CANONICAL: a stored row belongs to the acting employee when its
 * canonical employeeId matches (trim + uppercase) OR — for legacy rows written
 * before the empId column existed — its stored LINE user id matches. A blank
 * key never matches, and the display name is NEVER used as identity.
 *
 * The business date of every stored row is normalised with `sheetDateToYmd`,
 * which understands plain "YYYY-MM-DD" text AND the Google Sheets date-serial a
 * cell silently coerces to (the root cause of "checked in but checkout says not
 * checked in": the stored date read back as a serial/Date no longer string-
 * equalled "today").
 */
import { normalizeEmployeeId } from '@/lib/repositories/employee-repository';
import { parseSheetDate, sheetDateToYmd } from '@/lib/utils/datetime';

export type AttendanceType = 'checkin' | 'checkout';

/** A single attendance event row (long format: one row per check-in/out). */
export interface AttendanceRow {
  /** Raw date cell as read from the sheet (string, serial number, or Date). */
  date: unknown;
  /** LINE user id stored on the row. */
  userId?: string;
  /** Canonical employee id stored on the row (optional / blank on legacy rows). */
  empId?: string;
  /** 'checkin' | 'checkout' (case/space tolerant). */
  type?: string;
  /** Idempotency key stored on the row, if any. */
  clientRequestId?: string;
  time?: string;
  employmentType?: string;
  workHours?: string | number;
}

export interface AttendanceHistoryItem {
  date: string;
  checkin: string;
  checkout: string;
  workHours: number | null;
  employmentType: string;
  status: 'complete' | 'open';
}

function timeToMinutes(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 + minutes + seconds / 60;
}

/** Pair this employee's event rows by Bangkok business date. Sheet values win. */
export function buildAttendanceHistory(
  rows: readonly AttendanceRow[], key: EmployeeKey, month: number, year: number,
  fallbackEmploymentType = '',
): AttendanceHistoryItem[] {
  const days = new Map<string, { checkin: string; checkout: string; employmentType: string }>();
  for (const row of rows) {
    if (!rowMatchesEmployee(row, key)) continue;
    const date = sheetDateToYmd(row.date);
    const parsed = parseSheetDate(row.date);
    if (!date || !parsed || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month) continue;
    const type = normalizeType(row.type);
    if (!type) continue;
    const day = days.get(date) ?? { checkin: '', checkout: '', employmentType: '' };
    if (type === 'checkin' && !day.checkin) day.checkin = String(row.time ?? '').trim();
    if (type === 'checkout') day.checkout = String(row.time ?? '').trim();
    if (String(row.employmentType ?? '').trim()) day.employmentType = String(row.employmentType).trim();
    days.set(date, day);
  }
  return [...days.entries()].map(([date, day]) => {
    const start = timeToMinutes(day.checkin);
    const end = timeToMinutes(day.checkout);
    const workHours = start !== null && end !== null && end >= start ? (end - start) / 60 : null;
    return { date, checkin: day.checkin, checkout: day.checkout, workHours,
      employmentType: day.employmentType || fallbackEmploymentType,
      status: day.checkout ? 'complete' as const : 'open' as const };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export interface AttendanceSummary {
  /** Unique business dates that have a check-in (never counts event rows). */
  workDays: number;
  /** Canonical total worked minutes across COMPLETE days only (open days excluded). */
  totalMinutes: number;
}

/**
 * Summarise already-built history items (one per business date, already scoped to
 * one employee + month/year). Canonical numeric output only — UI does the Thai
 * formatting. A day counts as a work day when it has a check-in, even if the
 * check-out is still missing; but only complete days contribute to totalMinutes
 * (never guess a missing check-out from the current time).
 */
export function calculateAttendanceSummary(
  items: readonly AttendanceHistoryItem[],
): AttendanceSummary {
  let workDays = 0;
  let totalMinutes = 0;
  for (const item of items) {
    if (item.checkin) workDays++;
    if (item.workHours !== null) totalMinutes += item.workHours * 60;
  }
  // workHours carries seconds as a fraction of an hour; round the aggregate to a
  // whole minute so the canonical value is clean (HH:MM inputs stay exact).
  return { workDays, totalMinutes: Math.round(totalMinutes) };
}

/** The acting employee, resolved from the verified LINE token. */
export interface EmployeeKey {
  /** Canonical employeeId (may be '' when the employee is not linked yet). */
  employeeId: string;
  lineUserId: string;
}

/** True when a stored row belongs to the acting employee (canonical match). */
export function rowMatchesEmployee(row: AttendanceRow, key: EmployeeKey): boolean {
  const rowEmp = normalizeEmployeeId(String(row.empId ?? ''));
  const keyEmp = normalizeEmployeeId(String(key.employeeId ?? ''));
  if (rowEmp !== '' && keyEmp !== '' && rowEmp === keyEmp) return true;

  const rowLine = String(row.userId ?? '').trim();
  const keyLine = String(key.lineUserId ?? '').trim();
  if (rowLine !== '' && rowLine === keyLine) return true;

  return false;
}

function normalizeType(type: unknown): AttendanceType | null {
  const t = String(type ?? '').trim().toLowerCase();
  if (t === 'checkin' || t === 'check-in' || t === 'check_in') return 'checkin';
  if (t === 'checkout' || t === 'check-out' || t === 'check_out') return 'checkout';
  return null;
}

/** Aggregate of one employee's events on one business date. */
export interface DayAttendance {
  /** Rows belonging to this employee on this business date. */
  candidateCount: number;
  hasCheckin: boolean;
  hasCheckout: boolean;
}

/**
 * Summarise the acting employee's events for a business date. Rows of OTHER
 * employees and rows of other dates are ignored — never cross employees.
 */
export function summarizeDay(
  rows: readonly AttendanceRow[],
  key: EmployeeKey,
  businessDate: string,
): DayAttendance {
  let candidateCount = 0;
  let hasCheckin = false;
  let hasCheckout = false;

  for (const row of rows) {
    if (!rowMatchesEmployee(row, key)) continue;
    if (sheetDateToYmd(row.date) !== businessDate) continue;
    candidateCount++;
    const t = normalizeType(row.type);
    if (t === 'checkin') hasCheckin = true;
    else if (t === 'checkout') hasCheckout = true;
  }

  return { candidateCount, hasCheckin, hasCheckout };
}

export type CheckinDecision =
  | { allowed: true; reason: 'ok' }
  | { allowed: false; code: 'ALREADY_CHECKED_IN'; reason: 'already_checked_in'; message: string };

/** Check-in is allowed once per employee per business date. */
export function evaluateCheckin(day: DayAttendance): CheckinDecision {
  if (day.hasCheckin) {
    return {
      allowed: false,
      code: 'ALREADY_CHECKED_IN',
      reason: 'already_checked_in',
      message: 'วันนี้คุณเช็กอินแล้ว',
    };
  }
  return { allowed: true, reason: 'ok' };
}

export type CheckoutDecision =
  | { allowed: true; reason: 'open_checkin' }
  | { allowed: false; code: 'ALREADY_CHECKED_OUT'; reason: 'already_checked_out'; message: string }
  | { allowed: false; code: 'NOT_CHECKED_IN'; reason: 'no_checkin'; message: string };

/**
 * Check-out requires an OPEN check-in (a check-in exists for today and no
 * check-out yet). An already-checked-out employee gets a distinct "already
 * checked out" message — never the misleading "haven't checked in".
 */
export function evaluateCheckout(day: DayAttendance): CheckoutDecision {
  if (day.hasCheckout) {
    return {
      allowed: false,
      code: 'ALREADY_CHECKED_OUT',
      reason: 'already_checked_out',
      message: 'วันนี้คุณได้ออกงานแล้ว',
    };
  }
  if (!day.hasCheckin) {
    return {
      allowed: false,
      code: 'NOT_CHECKED_IN',
      reason: 'no_checkin',
      message: 'ยังไม่ได้เช็คอินวันนี้',
    };
  }
  return { allowed: true, reason: 'open_checkin' };
}

/** Whether an existing row already fulfils this (idempotent) client request. */
export function findByClientRequestId(
  rows: readonly AttendanceRow[],
  key: EmployeeKey,
  type: AttendanceType,
  clientRequestId: string,
): AttendanceRow | null {
  const id = String(clientRequestId ?? '').trim();
  if (!id) return null;
  for (const row of rows) {
    if (String(row.clientRequestId ?? '').trim() !== id) continue;
    if (normalizeType(row.type) !== type) continue;
    if (!rowMatchesEmployee(row, key)) continue;
    return row;
  }
  return null;
}
