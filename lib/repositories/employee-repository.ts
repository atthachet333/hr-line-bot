import { env } from '@/lib/env';
import { columnLetter, getSheetsClient } from '@/lib/sheets/client';

export interface Employee {
  lineUserId: string;
  employeeId: string;
  name: string;
  position: string;
  department: string;
  /** Optional per-employee manager. Falls back to the configured manager target. */
  managerLineUserId: string;
}

/** Normalise an employee id for matching: trim + uppercase. */
export function normalizeEmployeeId(employeeId: string): string {
  return employeeId.trim().toUpperCase();
}

interface EmployeesTable {
  header: string[];
  col: (name: string) => number;
  /** Data rows (header excluded). Index i maps to sheet row i + 2. */
  rows: string[][];
  sheetName: string;
}

async function loadTable(): Promise<EmployeesTable | null> {
  if (!env.googleSheetId()) return null;
  const { sheets, spreadsheetId } = await getSheetsClient();
  const sheetName = env.sheetNames.employees();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:ZZ`,
  });
  const values = (res.data.values as string[][] | undefined) ?? [];
  if (values.length === 0) return null;
  const header = values[0];
  const index = new Map(header.map((h, i) => [h, i] as const));
  return {
    header,
    col: (name: string) => (index.has(name) ? (index.get(name) as number) : -1),
    rows: values.slice(1),
    sheetName,
  };
}

function rowToEmployee(row: string[], col: EmployeesTable['col']): Employee {
  const cell = (name: string) => {
    const i = col(name);
    return i === -1 ? '' : (row[i] ?? '');
  };
  return {
    lineUserId: cell('lineUserId'),
    employeeId: cell('employeeId'),
    name: cell('name'),
    position: cell('position'),
    department: cell('department'),
    managerLineUserId: cell('managerLineUserId'),
  };
}

/**
 * Resolve the authoritative employee record for a verified LINE user id.
 *
 * Identity comes ONLY from the Employees sheet (looked up after the LINE token
 * has been verified server-side). The Apps Script `getBalance` action is
 * deliberately NOT used to establish identity.
 *
 * Returns null when no row has this exact lineUserId (i.e. not linked yet, or
 * the sheet holds a different/incorrect lineUserId for the employee).
 */
export async function findByLineUserId(lineUserId: string): Promise<Employee | null> {
  if (!lineUserId) return null;
  try {
    const table = await loadTable();
    if (!table || table.col('lineUserId') === -1) return null;
    const iLine = table.col('lineUserId');
    const row = table.rows.find((r) => (r[iLine] ?? '') === lineUserId);
    return row ? rowToEmployee(row, table.col) : null;
  } catch {
    return null;
  }
}

/** Look up an employee by (normalised) employeeId. Returns the row number too. */
export async function findByEmployeeId(
  employeeId: string,
): Promise<{ employee: Employee; rowNumber: number } | null> {
  const target = normalizeEmployeeId(employeeId);
  const table = await loadTable();
  if (!table || table.col('employeeId') === -1) return null;
  const iEmp = table.col('employeeId');
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    if (normalizeEmployeeId(row[iEmp] ?? '') === target) {
      return { employee: rowToEmployee(row, table.col), rowNumber: i + 2 };
    }
  }
  return null;
}

export type LinkResult =
  /** Newly linked this LINE user to the employee row. */
  | { status: 'linked'; employee: Employee }
  /** This LINE user was already linked to this same employee (idempotent). */
  | { status: 'already_linked'; employee: Employee }
  /** No row matches the employeeId. */
  | { status: 'employee_not_found' }
  /** The employeeId row is already linked to a DIFFERENT LINE user. */
  | { status: 'employee_already_linked' }
  /** This LINE user is already linked to a DIFFERENT employeeId. */
  | { status: 'line_already_linked'; employeeId: string };

/**
 * Serialise link/unlink operations within this process. The app runs as a
 * single PM2 instance (hr-line-bot), so an in-process mutex + a read-check-write
 * guard closes the practical race window for concurrent self-service links.
 */
let linkChain: Promise<unknown> = Promise.resolve();
function withLinkLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = linkChain.then(fn, fn);
  // Keep the chain alive regardless of individual outcomes.
  linkChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeLineUserId(
  table: EmployeesTable,
  rowNumber: number,
  value: string,
): Promise<void> {
  const iLine = table.col('lineUserId');
  if (iLine === -1) throw new Error('Employees sheet is missing the lineUserId column');
  const { sheets, spreadsheetId } = await getSheetsClient();
  const cell = `${columnLetter(iLine)}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${table.sheetName}!${cell}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

/**
 * Link a verified LINE user id to an employeeId row.
 *
 * Safety rules (never overwrite an existing, different link automatically):
 *  - If this LINE user is already on some row: same employee -> idempotent OK;
 *    different employee -> line_already_linked.
 *  - Else find the employeeId row: missing -> employee_not_found; blank
 *    lineUserId -> write it; non-blank (someone else) -> employee_already_linked.
 */
export async function linkEmployee(employeeId: string, lineUserId: string): Promise<LinkResult> {
  const target = normalizeEmployeeId(employeeId);
  return withLinkLock(async () => {
    const table = await loadTable();
    if (!table || table.col('employeeId') === -1 || table.col('lineUserId') === -1) {
      return { status: 'employee_not_found' };
    }
    const iEmp = table.col('employeeId');
    const iLine = table.col('lineUserId');

    // 1) Is this LINE user already linked to a row?
    const existingIdx = table.rows.findIndex((r) => (r[iLine] ?? '') === lineUserId);
    if (existingIdx !== -1) {
      const existing = rowToEmployee(table.rows[existingIdx], table.col);
      if (normalizeEmployeeId(existing.employeeId) === target) {
        return { status: 'already_linked', employee: existing };
      }
      return { status: 'line_already_linked', employeeId: existing.employeeId };
    }

    // 2) Find the target employee row.
    const targetIdx = table.rows.findIndex((r) => normalizeEmployeeId(r[iEmp] ?? '') === target);
    if (targetIdx === -1) return { status: 'employee_not_found' };

    const targetRow = table.rows[targetIdx];
    const currentLine = targetRow[iLine] ?? '';
    if (currentLine && currentLine !== lineUserId) {
      return { status: 'employee_already_linked' };
    }

    // 3) Write — re-read the single cell first to narrow the race window.
    const rowNumber = targetIdx + 2;
    const fresh = await findByEmployeeId(target);
    if (fresh && fresh.employee.lineUserId && fresh.employee.lineUserId !== lineUserId) {
      return { status: 'employee_already_linked' };
    }
    await writeLineUserId(table, rowNumber, lineUserId);
    return { status: 'linked', employee: { ...rowToEmployee(targetRow, table.col), lineUserId } };
  });
}

export type UnlinkResult =
  | { status: 'unlinked'; employee: Employee; previousLineUserId: string }
  | { status: 'employee_not_found' }
  | { status: 'not_linked'; employee: Employee };

/**
 * Clear ONLY the lineUserId cell for an employeeId (never deletes the row).
 * Used by the HR unlink script to recover from a wrong manual entry.
 */
export async function unlinkEmployee(employeeId: string): Promise<UnlinkResult> {
  const target = normalizeEmployeeId(employeeId);
  return withLinkLock(async () => {
    const table = await loadTable();
    if (!table || table.col('employeeId') === -1 || table.col('lineUserId') === -1) {
      return { status: 'employee_not_found' };
    }
    const iEmp = table.col('employeeId');
    const idx = table.rows.findIndex((r) => normalizeEmployeeId(r[iEmp] ?? '') === target);
    if (idx === -1) return { status: 'employee_not_found' };

    const employee = rowToEmployee(table.rows[idx], table.col);
    if (!employee.lineUserId) return { status: 'not_linked', employee };

    await writeLineUserId(table, idx + 2, '');
    return { status: 'unlinked', employee, previousLineUserId: employee.lineUserId };
  });
}
