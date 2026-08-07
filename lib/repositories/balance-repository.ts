import { env } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';
import { normalizeEmployeeId } from '@/lib/repositories/employee-repository';

/** Leave-entitlement categories tracked by the Balances sheet. */
export interface Entitlements {
  sick: number;
  business: number;
  annual: number;
}

/** Which entitlement columns yielded a valid number for the matched row. */
export interface EntitlementFields {
  sick: boolean;
  business: boolean;
  annual: boolean;
}

export type EntitlementLookup =
  | { status: 'ok'; entitlements: Entitlements; fields: EntitlementFields }
  /** No row matches this employeeId. */
  | { status: 'not_found' }
  /** Row found but an entitlement is blank / non-numeric / negative. */
  | { status: 'invalid'; reason: string; fields: EntitlementFields }
  /** More than one row has this employeeId. */
  | { status: 'duplicate'; count: number };

// Header aliases per column (normalised: trimmed, inner whitespace collapsed,
// lowercased). Supports the English contract, the live sheet's names, and Thai.
const ID_ALIASES = ['employeeid', 'empid', 'รหัสพนักงาน', 'รหัสพนง'];
const CATEGORY_ALIASES: Record<keyof Entitlements, string[]> = {
  sick: ['sick', 'sickleave', 'sicktotal', 'sickentitlement', 'sickdays', 'ลาป่วย'],
  business: ['business', 'personalleave', 'personal', 'businesstotal', 'personaltotal', 'businessentitlement', 'ลากิจ'],
  annual: ['annual', 'annualleave', 'annualtotal', 'annualentitlement', 'vacation', 'ลาพักร้อน'],
};

function normHeader(h: unknown): string {
  return String(h ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Parse an entitlement cell. A blank cell is MISSING data (not 0). A non-numeric
 * or negative value is invalid. Zero is a valid entitlement.
 */
function parseEntitlement(raw: unknown): { ok: true; value: number } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: false };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? { ok: true, value: raw } : { ok: false };
  }
  const s = String(raw).trim();
  if (s === '') return { ok: false };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false };
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

/**
 * Look up an employee's leave entitlements from the Balances sheet, matched
 * STRICTLY by employeeId (the sheet's id column). The LINE user id is never used
 * as the entitlement key. Returns a discriminated result so the caller can emit
 * the right code (BALANCE_NOT_CONFIGURED / BALANCE_DATA_INVALID) — never a
 * fabricated 0 balance.
 */
export async function findEntitlements(employeeId: string): Promise<EntitlementLookup> {
  const target = normalizeEmployeeId(employeeId);

  let values: unknown[][];
  try {
    if (!env.googleSheetId()) return { status: 'not_found' };
    const { sheets, spreadsheetId } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${env.sheetNames.balances()}!A1:ZZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    values = (res.data.values as unknown[][] | undefined) ?? [];
  } catch {
    return { status: 'not_found' }; // sheet/tab missing
  }
  if (values.length < 2) return { status: 'not_found' };

  const header = values[0].map(normHeader);
  const findCol = (aliases: string[]) => {
    for (const a of aliases) {
      const i = header.indexOf(a);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iEmp = findCol(ID_ALIASES);
  if (iEmp === -1) return { status: 'not_found' }; // no id column to match on

  const iSick = findCol(CATEGORY_ALIASES.sick);
  const iBusiness = findCol(CATEGORY_ALIASES.business);
  const iAnnual = findCol(CATEGORY_ALIASES.annual);

  const matches: number[] = [];
  for (let r = 1; r < values.length; r++) {
    if (normalizeEmployeeId(String(values[r][iEmp] ?? '')) === target) matches.push(r);
  }
  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length > 1) return { status: 'duplicate', count: matches.length };

  const row = values[matches[0]];
  const cats: Array<[keyof Entitlements, number]> = [
    ['sick', iSick],
    ['business', iBusiness],
    ['annual', iAnnual],
  ];
  const entitlements: Entitlements = { sick: 0, business: 0, annual: 0 };
  const fields: EntitlementFields = { sick: false, business: false, annual: false };
  const problems: string[] = [];
  for (const [key, idx] of cats) {
    if (idx === -1) {
      problems.push(`ไม่พบคอลัมน์สิทธิ์ ${key}`);
      continue;
    }
    const parsed = parseEntitlement(row[idx]);
    if (parsed.ok) {
      entitlements[key] = parsed.value;
      fields[key] = true;
    } else {
      problems.push(`ค่าสิทธิ์ ${key} ไม่ถูกต้องหรือว่างเปล่า`);
    }
  }

  if (problems.length > 0) {
    return { status: 'invalid', reason: problems.join('; '), fields };
  }
  return { status: 'ok', entitlements, fields };
}
