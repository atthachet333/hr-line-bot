/**
 * Server-side attendance persistence on the Attendance sheet.
 *
 * Long format — one row per event. The historical header (written by the older
 * Apps Script path) is preserved exactly:
 *   timestamp | date | userId | displayName | type | time | lat | lng | summary | clientRequestId
 * A canonical `empId` column is appended when missing so identity is keyed on
 * the employeeId (with the LINE user id kept for backward-compatible matching of
 * rows written before this column existed). Existing rows/headers are never
 * reordered or deleted.
 *
 * The `date` cell is written as RAW text ("YYYY-MM-DD") so Google Sheets cannot
 * silently coerce it into a date-serial — and reads use UNFORMATTED_VALUE and
 * `sheetDateToYmd`, which understands both text and any legacy serial. This is
 * the fix for "checked in but check-out says not checked in".
 *
 * Writes are serialised with an in-process mutex; the app runs as a single PM2
 * instance (hr-line-bot), so this closes the practical read-check-append race.
 */
import { env } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';
import { nowIso, sheetDateToYmd } from '@/lib/utils/datetime';
import {
  buildAttendanceHistory,
  type AttendanceHistoryItem,
  type AttendanceRow,
  type AttendanceType,
  type DayAttendance,
  type EmployeeKey,
  evaluateCheckin,
  evaluateCheckout,
  findByClientRequestId,
  rowMatchesEmployee,
  summarizeDay,
} from '@/lib/attendance/attendance-core';

/** Canonical header used when the sheet is empty / has no header yet. */
const DEFAULT_HEADER = [
  'timestamp', 'date', 'userId', 'displayName', 'type',
  'time', 'lat', 'lng', 'summary', 'clientRequestId', 'empId', 'employmentType', 'workHours',
] as const;
const REQUIRED_COLUMNS = ['empId', 'employmentType', 'workHours'] as const;

export interface RecordAttendanceInput {
  type: AttendanceType;
  lineUserId: string;
  employeeId: string; // canonical, may be ''
  displayName: string;
  businessDate: string; // YYYY-MM-DD (Asia/Bangkok), computed by the caller
  time: string;
  lat: number;
  lng: number;
  summary?: string;
  clientRequestId?: string;
  employmentType?: string;
}

/** Non-sensitive diagnostics for structured logging (no ids/tokens). */
export interface AttendanceDiag {
  businessDate: string;
  employeeResolved: boolean;
  candidateCount: number;
  openCheckinFound: boolean;
  reason: string;
}

export type RecordAttendanceResult =
  | { ok: true; code: 'CHECK_IN_RECORDED' | 'CHECK_OUT_RECORDED'; message: string; data: { date: string; type: AttendanceType }; diag: AttendanceDiag }
  | { ok: false; kind: 'conflict'; code: 'ALREADY_CHECKED_IN' | 'ALREADY_CHECKED_OUT' | 'NOT_CHECKED_IN'; message: string; diag: AttendanceDiag }
  | { ok: false; kind: 'not_configured'; code: 'NOT_CONFIGURED'; message: string; diag: AttendanceDiag }
  | { ok: false; kind: 'io'; code: 'IO_ERROR'; message: string; diag: AttendanceDiag };

interface Table {
  header: string[];
  col: (name: string) => number;
  rows: AttendanceRow[];
}

function normHeader(h: unknown): string {
  return String(h ?? '').trim();
}

async function loadTable(sheetName: string): Promise<Table | null> {
  const { sheets, spreadsheetId } = await getSheetsClient();
  let values: unknown[][] = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:ZZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    values = (res.data.values as unknown[][] | undefined) ?? [];
  } catch {
    // Tab does not exist yet — treat as empty (it will be created on write).
    return { header: [], col: () => -1, rows: [] };
  }
  if (values.length === 0) return { header: [], col: () => -1, rows: [] };

  const header = values[0].map(normHeader);
  const index = new Map(header.map((h, i) => [h, i] as const));
  const col = (name: string) => (index.has(name) ? (index.get(name) as number) : -1);

  const iDate = col('date');
  const iUser = col('userId');
  const iEmp = col('empId');
  const iType = col('type');
  const iCrid = col('clientRequestId');
  const iTime = col('time');
  const iEmploymentType = col('employmentType');
  const iWorkHours = col('workHours');

  const rows: AttendanceRow[] = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    rows.push({
      date: iDate === -1 ? '' : row[iDate],
      userId: iUser === -1 ? '' : String(row[iUser] ?? ''),
      empId: iEmp === -1 ? '' : String(row[iEmp] ?? ''),
      type: iType === -1 ? '' : String(row[iType] ?? ''),
      clientRequestId: iCrid === -1 ? '' : String(row[iCrid] ?? ''),
      time: iTime === -1 ? '' : String(row[iTime] ?? ''),
      employmentType: iEmploymentType === -1 ? '' : String(row[iEmploymentType] ?? ''),
      workHours: iWorkHours === -1 ? '' : String(row[iWorkHours] ?? ''),
    });
  }
  return { header, col, rows };
}

async function ensureAttendanceColumns(table: Table, sheetName: string): Promise<string[]> {
  const header = table.header.length ? [...table.header] : [...DEFAULT_HEADER];
  for (const required of REQUIRED_COLUMNS) if (!header.includes(required)) header.push(required);
  // Nothing to migrate — existing header already has every required column.
  if (table.header.length === header.length && table.header.length > 0) return header;
  // Best-effort header migration. If the write fails we fall back to whatever
  // header the sheet already has so the row append still succeeds positionally.
  try {
    await ensureSheet(sheetName);
    const { sheets, spreadsheetId } = await getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${sheetName}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [header] },
    });
    return header;
  } catch {
    return table.header.length ? table.header : header;
  }
}

function workHoursBetween(checkin: unknown, checkout: unknown): string {
  const minutes = (value: unknown): number | null => {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
    if (!m) return null;
    const result = Number(m[1]) * 60 + Number(m[2]) + Number(m[3] ?? 0) / 60;
    return Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3] ?? 0) < 60 ? result : null;
  };
  const start = minutes(checkin); const end = minutes(checkout);
  return start !== null && end !== null && end >= start ? String(Number(((end - start) / 60).toFixed(4))) : '';
}

/** Ensure the tab exists; ignore the error when it already does. */
async function ensureSheet(sheetName: string): Promise<void> {
  const { sheets, spreadsheetId } = await getSheetsClient();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  } catch {
    /* already exists — fine */
  }
}

/** Build a row array positionally for the given header. */
function buildRow(header: string[], fields: Record<string, string | number>): (string | number)[] {
  return header.map((h) => {
    const v = fields[h];
    return v === undefined ? '' : v;
  });
}

// Serialise attendance writes within this process (single PM2 instance).
let writeChain: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

function diagFrom(input: RecordAttendanceInput, day: DayAttendance, reason: string): AttendanceDiag {
  return {
    businessDate: input.businessDate,
    employeeResolved: input.employeeId.trim() !== '',
    candidateCount: day.candidateCount,
    openCheckinFound: day.hasCheckin && !day.hasCheckout,
    reason,
  };
}

/**
 * Record a check-in or check-out, enforcing the canonical per-employee/per-date
 * rules. Never mutates or reads another employee's rows.
 */
export function recordAttendance(input: RecordAttendanceInput): Promise<RecordAttendanceResult> {
  return withWriteLock(async () => {
    const emptyDay: DayAttendance = { candidateCount: 0, hasCheckin: false, hasCheckout: false };
    if (!env.googleSheetId()) {
      return {
        ok: false, kind: 'not_configured', code: 'NOT_CONFIGURED',
        message: 'ระบบลงเวลายังไม่ได้ตั้งค่า',
        diag: diagFrom(input, emptyDay, 'not_configured'),
      };
    }

    const sheetName = env.sheetNames.attendance();
    const key: EmployeeKey = { employeeId: input.employeeId, lineUserId: input.lineUserId };

    try {
      const table = await loadTable(sheetName);
      if (!table) {
        return {
          ok: false, kind: 'io', code: 'IO_ERROR', message: 'อ่านข้อมูลลงเวลาไม่สำเร็จ',
          diag: diagFrom(input, emptyDay, 'load_failed'),
        };
      }

      // Idempotent replay of a resubmitted request → report success without a dup row.
      if (input.clientRequestId) {
        const dup = findByClientRequestId(table.rows, key, input.type, input.clientRequestId);
        if (dup) {
          const day = summarizeDay(table.rows, key, input.businessDate);
          return input.type === 'checkin'
            ? { ok: true, code: 'CHECK_IN_RECORDED', message: 'บันทึกเวลาเข้างานสำเร็จ', data: { date: input.businessDate, type: 'checkin' }, diag: diagFrom(input, day, 'idempotent_replay') }
            : { ok: true, code: 'CHECK_OUT_RECORDED', message: 'บันทึกเวลาออกงานสำเร็จ', data: { date: input.businessDate, type: 'checkout' }, diag: diagFrom(input, day, 'idempotent_replay') };
        }
      }

      const day = summarizeDay(table.rows, key, input.businessDate);

      if (input.type === 'checkin') {
        const decision = evaluateCheckin(day);
        if (!decision.allowed) {
          return { ok: false, kind: 'conflict', code: decision.code, message: decision.message, diag: diagFrom(input, day, decision.reason) };
        }
      } else {
        const decision = evaluateCheckout(day);
        if (!decision.allowed) {
          return { ok: false, kind: 'conflict', code: decision.code, message: decision.message, diag: diagFrom(input, day, decision.reason) };
        }
      }

      // Append the event. Header is created (with empId) only when the tab is empty.
      const header = await ensureAttendanceColumns(table, sheetName);
      const { sheets, spreadsheetId } = await getSheetsClient();
      const checkinRow = input.type === 'checkout'
        ? table.rows.find((row) => rowMatchesEmployee(row, key) && sheetDateToYmd(row.date) === input.businessDate && String(row.type).toLowerCase() === 'checkin')
        : undefined;

      const rowValues = buildRow(header, {
        timestamp: nowIso(),
        date: input.businessDate, // RAW text — never coerced to a serial
        userId: input.lineUserId,
        displayName: input.displayName,
        type: input.type,
        time: input.time,
        lat: input.lat,
        lng: input.lng,
        summary: input.summary ?? '',
        clientRequestId: input.clientRequestId ?? '',
        empId: input.employeeId,
        employmentType: input.employmentType ?? '',
        workHours: input.type === 'checkout' ? workHoursBetween(checkinRow?.time, input.time) : '',
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowValues] },
      });

      return input.type === 'checkin'
        ? { ok: true, code: 'CHECK_IN_RECORDED', message: 'บันทึกเวลาเข้างานสำเร็จ', data: { date: input.businessDate, type: 'checkin' }, diag: diagFrom(input, day, 'recorded') }
        : { ok: true, code: 'CHECK_OUT_RECORDED', message: 'บันทึกเวลาออกงานสำเร็จ', data: { date: input.businessDate, type: 'checkout' }, diag: diagFrom(input, day, 'recorded') };
    } catch (err) {
      return {
        ok: false, kind: 'io', code: 'IO_ERROR',
        message: 'บันทึกเวลาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        diag: diagFrom(input, emptyDay, `io_error: ${err instanceof Error ? err.message : 'unknown'}`),
      };
    }
  });
}

export async function getAttendanceHistory(input: {
  lineUserId: string; employeeId: string; employmentType: string; month: number; year: number;
}): Promise<AttendanceHistoryItem[]> {
  const sheetName = env.sheetNames.attendance();
  const table = await loadTable(sheetName);
  if (!table) return [];
  // History is READ-ONLY (Google Sheets is the source of truth, no-store): never
  // migrate columns here. buildAttendanceHistory works with whatever columns
  // exist — empId is optional and workHours is recomputed from the sheet times.
  return buildAttendanceHistory(table.rows, {
    lineUserId: input.lineUserId, employeeId: input.employeeId,
  }, input.month, input.year, input.employmentType);
}
