import { env } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';
import { callAppsScript } from '@/lib/google-apps-script/client';

export interface Employee {
  lineUserId: string;
  employeeId: string;
  name: string;
  position: string;
  department: string;
  /** Optional per-employee manager. Falls back to the configured manager target. */
  managerLineUserId: string;
}

/**
 * Look up an employee record from the Employees sheet by LINE user id.
 *
 * Expected Employees sheet header columns (order-independent, matched by name):
 *   lineUserId | employeeId | name | position | department | managerLineUserId
 *
 * Returns null when the sheet/row is not found so callers can fall back.
 */
async function findInSheet(lineUserId: string): Promise<Employee | null> {
  if (!env.googleSheetId()) return null;
  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    const name = env.sheetNames.employees();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${name}!A1:ZZ`,
    });
    const values = (res.data.values as string[][] | undefined) ?? [];
    if (values.length < 2) return null;

    const header = values[0];
    const idx = (col: string) => header.indexOf(col);
    const iLine = idx('lineUserId');
    if (iLine === -1) return null;

    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if ((row[iLine] ?? '') === lineUserId) {
        const cell = (col: string) => {
          const i = idx(col);
          return i === -1 ? '' : (row[i] ?? '');
        };
        return {
          lineUserId,
          employeeId: cell('employeeId'),
          name: cell('name'),
          position: cell('position'),
          department: cell('department'),
          managerLineUserId: cell('managerLineUserId'),
        };
      }
    }
    return null;
  } catch {
    // Sheet may not exist yet — fall back to Apps Script.
    return null;
  }
}

/** Fallback: resolve the employee profile through the existing Apps Script. */
async function findViaAppsScript(lineUserId: string): Promise<Employee | null> {
  const result = await callAppsScript<{
    status?: string;
    data?: { name?: string; empId?: string; position?: string; department?: string };
  }>({ action: 'getBalance', userId: lineUserId });

  if (!result.ok) return null;
  const data = result.data.data;
  if (result.data.status !== 'success' || !data) return null;
  if (!data.empId && (!data.name || data.name === 'รอระบุชื่อ')) return null;

  return {
    lineUserId,
    employeeId: data.empId ?? '',
    name: data.name && data.name !== 'รอระบุชื่อ' ? data.name : '',
    position: data.position ?? '',
    department: data.department ?? '',
    managerLineUserId: '',
  };
}

/**
 * Resolve the authoritative employee record for a verified LINE user id.
 * Tries the Employees sheet first, then the Apps Script balance endpoint.
 * Returns null when the user is not linked to any employee.
 */
export async function findByLineUserId(lineUserId: string): Promise<Employee | null> {
  const fromSheet = await findInSheet(lineUserId);
  if (fromSheet) return fromSheet;
  return findViaAppsScript(lineUserId);
}
