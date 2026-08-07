import type { sheets_v4 } from 'googleapis/build/src/apis/sheets';
import { env } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';
import { LEAVE_REQUEST_CORE_COLUMNS, LEAVE_REQUEST_EVIDENCE_COLUMNS } from '@/lib/domain/leave-request';

export interface SheetCheck {
  sheet: string;
  status: 'ok' | 'missing' | 'empty' | 'header_mismatch' | 'error';
  missingColumns?: string[];
  duplicateColumns?: string[];
  message?: string;
}

export interface SheetsSchemaReport {
  ok: boolean;
  checks: SheetCheck[];
}

interface SheetSpec {
  name: string;
  required: string[];
  /** When true, an empty sheet is acceptable (header may be auto-created). */
  allowEmpty?: boolean;
  /** When false, the sheet is optional (only validated if present). */
  requiredSheet?: boolean;
}

function specs(): SheetSpec[] {
  return [
    { name: env.sheetNames.leaveRequests(), required: LEAVE_REQUEST_CORE_COLUMNS as string[], allowEmpty: true, requiredSheet: true },
    { name: env.sheetNames.employees(), required: ['lineUserId', 'employeeId', 'name'], requiredSheet: true },
    {
      name: env.sheetNames.auditLog(),
      required: ['timestamp', 'requestId', 'action', 'webhookEventId'],
      allowEmpty: true,
      requiredSheet: true,
    },
    { name: env.sheetNames.holidays(), required: ['date'], requiredSheet: false },
  ];
}

// ---- Balances sheet: header + per-row entitlement validation ----

const BAL_ID_ALIASES = ['employeeid', 'empid', 'รหัสพนักงาน', 'รหัสพนง'];
const BAL_CATEGORY_ALIASES: Record<'sick' | 'business' | 'annual', string[]> = {
  sick: ['sick', 'sickleave', 'sicktotal', 'sickentitlement', 'sickdays', 'ลาป่วย'],
  business: ['business', 'personalleave', 'personal', 'businesstotal', 'personaltotal', 'businessentitlement', 'ลากิจ'],
  annual: ['annual', 'annualleave', 'annualtotal', 'annualentitlement', 'vacation', 'ลาพักร้อน'],
};

function normH(h: unknown): string {
  return String(h ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isNumericEntitlement(raw: unknown): boolean {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0;
  const s = String(raw ?? '').trim();
  return /^\d+(\.\d+)?$/.test(s) && parseFloat(s) >= 0;
}

/**
 * Validate the Balances tab: employeeId + sick/business/annual columns exist,
 * no duplicate employeeId, and every entitlement is a number >= 0. Reports row
 * numbers (never the employee data itself). Missing tab is OK (optional).
 */
async function checkBalances(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  name: string,
): Promise<SheetCheck> {
  let values: unknown[][];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${name}!A1:ZZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    values = (res.data.values as unknown[][] | undefined) ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Unable to parse range|not found/i.test(message)) {
      return { sheet: name, status: 'ok', message: 'optional sheet not present' };
    }
    return { sheet: name, status: 'error', message: message.slice(0, 200) };
  }
  if (values.length === 0) return { sheet: name, status: 'ok', message: 'optional sheet not present' };

  const header = values[0].map(normH);
  const findCol = (aliases: string[]) => aliases.map((a) => header.indexOf(a)).find((i) => i !== -1) ?? -1;
  const iEmp = findCol(BAL_ID_ALIASES);
  const cats = {
    sick: findCol(BAL_CATEGORY_ALIASES.sick),
    business: findCol(BAL_CATEGORY_ALIASES.business),
    annual: findCol(BAL_CATEGORY_ALIASES.annual),
  };

  const missingCols: string[] = [];
  if (iEmp === -1) missingCols.push('employeeId');
  (['sick', 'business', 'annual'] as const).forEach((k) => {
    if (cats[k] === -1) missingCols.push(k);
  });
  if (iEmp === -1 || (cats.sick === -1 && cats.business === -1 && cats.annual === -1)) {
    return { sheet: name, status: 'header_mismatch', missingColumns: missingCols };
  }

  const seen = new Map<string, number>();
  const dupRows: number[] = [];
  const invalidRows: number[] = [];
  const warnRows: number[] = [];
  for (let r = 1; r < values.length; r++) {
    const sheetRow = r + 1;
    const row = values[r];
    const empId = String(row[iEmp] ?? '').trim();
    if (!empId) {
      warnRows.push(sheetRow); // blank employeeId row
      continue;
    }
    const key = empId.toUpperCase();
    if (seen.has(key)) dupRows.push(sheetRow);
    else seen.set(key, sheetRow);

    for (const k of ['sick', 'business', 'annual'] as const) {
      const idx = cats[k];
      if (idx === -1) continue;
      const cell = row[idx];
      if (cell === undefined || cell === null || String(cell).trim() === '') {
        warnRows.push(sheetRow); // blank entitlement = missing data
      } else if (!isNumericEntitlement(cell)) {
        invalidRows.push(sheetRow); // non-numeric / negative
      }
    }
  }

  if (dupRows.length > 0 || invalidRows.length > 0) {
    const parts: string[] = [];
    if (missingCols.length) parts.push(`missing columns: ${missingCols.join(', ')}`);
    if (dupRows.length) parts.push(`duplicate employeeId at rows ${[...new Set(dupRows)].join(', ')}`);
    if (invalidRows.length) parts.push(`non-numeric entitlement at rows ${[...new Set(invalidRows)].join(', ')}`);
    return { sheet: name, status: 'error', message: parts.join('; ') };
  }

  const warnings: string[] = [];
  if (missingCols.length) warnings.push(`missing optional columns: ${missingCols.join(', ')}`);
  if (warnRows.length) warnings.push(`blank employeeId/entitlement at rows ${[...new Set(warnRows)].join(', ')}`);
  return { sheet: name, status: 'ok', message: warnings.length ? `warnings — ${warnings.join('; ')}` : undefined };
}

function duplicates(header: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) dup.add(h);
    seen.add(h);
  }
  return [...dup];
}

async function checkSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  spec: SheetSpec,
): Promise<SheetCheck> {
  let header: string[];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${spec.name}!1:1`,
    });
    header = (res.data.values?.[0] as string[] | undefined) ?? [];
  } catch (err) {
    // A missing tab surfaces as an API error.
    const message = err instanceof Error ? err.message : String(err);
    if (!spec.requiredSheet) {
      return { sheet: spec.name, status: 'ok', message: 'optional sheet not present' };
    }
    return { sheet: spec.name, status: /Unable to parse range|not found/i.test(message) ? 'missing' : 'error', message: message.slice(0, 200) };
  }

  if (header.length === 0) {
    return spec.allowEmpty
      ? { sheet: spec.name, status: 'ok', message: 'empty (header can be auto-created)' }
      : { sheet: spec.name, status: 'empty', message: 'ต้องมี header row' };
  }

  const dup = duplicates(header);
  const missing = spec.required.filter((c) => !header.includes(c));
  if (dup.length > 0 || missing.length > 0) {
    return {
      sheet: spec.name,
      status: 'header_mismatch',
      missingColumns: missing.length ? missing : undefined,
      duplicateColumns: dup.length ? dup : undefined,
    };
  }

  return { sheet: spec.name, status: 'ok' };
}

/**
 * Non-failing check: are the optional evidence columns present on LeaveRequests?
 * Missing columns are reported as a warning (migration needed) — never an error,
 * so evidence stays a soft add-on.
 */
async function checkLeaveEvidenceColumns(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  name: string,
): Promise<SheetCheck> {
  const sheet = `${name} (evidence)`;
  let header: string[];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${name}!1:1` });
    header = (res.data.values?.[0] as string[] | undefined) ?? [];
  } catch {
    return { sheet, status: 'ok', message: 'skipped' };
  }
  if (header.length === 0) return { sheet, status: 'ok', message: 'header not created yet' };
  const missing = (LEAVE_REQUEST_EVIDENCE_COLUMNS as string[]).filter((c) => !header.includes(c));
  return missing.length === 0
    ? { sheet, status: 'ok' }
    : { sheet, status: 'ok', message: `evidence columns not migrated yet: ${missing.join(', ')}` };
}

/**
 * Validate that the required Google Sheets tabs and headers exist and match the
 * repository mapping. Never returns employee data — only structural info.
 */
export async function validateSheetsSchema(deps?: {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
}): Promise<SheetsSchemaReport> {
  const { sheets, spreadsheetId } = deps ?? (await getSheetsClient());
  const checks: SheetCheck[] = [];
  for (const spec of specs()) {
    checks.push(await checkSheet(sheets, spreadsheetId, spec));
  }
  checks.push(await checkBalances(sheets, spreadsheetId, env.sheetNames.balances()));
  checks.push(await checkLeaveEvidenceColumns(sheets, spreadsheetId, env.sheetNames.leaveRequests()));
  return { ok: checks.every((c) => c.status === 'ok'), checks };
}
