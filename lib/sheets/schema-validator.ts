import type { sheets_v4 } from 'googleapis';
import { env } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';
import { LEAVE_REQUEST_COLUMNS } from '@/lib/domain/leave-request';

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
    { name: env.sheetNames.leaveRequests(), required: LEAVE_REQUEST_COLUMNS as string[], allowEmpty: true, requiredSheet: true },
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
  return { ok: checks.every((c) => c.status === 'ok'), checks };
}
