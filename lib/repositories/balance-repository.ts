import { env } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';
import { normalizeEmployeeId } from '@/lib/repositories/employee-repository';

/** Leave-entitlement categories tracked by the Balances sheet. */
export interface Entitlements {
  sick: number;
  business: number;
  annual: number;
}

// Accepted header names per column, matched case-insensitively and order-
// independent. Covers the live sheet (LineUserID / EmpID / SickLeave /
// PersonalLeave / AnnualLeave) plus common alternatives.
const ID_ALIASES = ['empid', 'employeeid'];
const LINE_ALIASES = ['lineuserid', 'lineuserids', 'userid'];
const CATEGORY_ALIASES: Record<keyof Entitlements, string[]> = {
  sick: ['sickleave', 'sick', 'sicktotal', 'sickentitlement', 'sickdays'],
  business: ['personalleave', 'business', 'personal', 'businesstotal', 'personaltotal', 'businessentitlement'],
  annual: ['annualleave', 'annual', 'annualtotal', 'annualentitlement', 'vacation'],
};

function toNumber(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read an employee's leave entitlements from the Balances sheet, matched by
 * EmpID (preferred) or LineUserID. Returns null when the sheet is absent or has
 * no row for the employee — callers must surface a clear config/data error,
 * never a fabricated balance.
 */
export async function findEntitlements(
  employeeId: string,
  lineUserId?: string,
): Promise<Entitlements | null> {
  if (!env.googleSheetId()) return null;
  const targetEmp = normalizeEmployeeId(employeeId);

  let values: unknown[][];
  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${env.sheetNames.balances()}!A1:ZZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    values = (res.data.values as unknown[][] | undefined) ?? [];
  } catch {
    return null; // sheet/tab missing
  }
  if (values.length < 2) return null;

  const header = values[0].map((h) => String(h ?? '').trim().toLowerCase());
  const findCol = (aliases: string[]) => {
    for (const a of aliases) {
      const i = header.indexOf(a);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iEmp = findCol(ID_ALIASES);
  const iLine = findCol(LINE_ALIASES);
  if (iEmp === -1 && iLine === -1) return null;

  const iSick = findCol(CATEGORY_ALIASES.sick);
  const iBusiness = findCol(CATEGORY_ALIASES.business);
  const iAnnual = findCol(CATEGORY_ALIASES.annual);

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const empMatch = iEmp !== -1 && normalizeEmployeeId(String(row[iEmp] ?? '')) === targetEmp;
    const lineMatch =
      !!lineUserId && iLine !== -1 && String(row[iLine] ?? '').trim() === lineUserId;
    if (empMatch || lineMatch) {
      return {
        sick: iSick === -1 ? 0 : toNumber(row[iSick]),
        business: iBusiness === -1 ? 0 : toNumber(row[iBusiness]),
        annual: iAnnual === -1 ? 0 : toNumber(row[iAnnual]),
      };
    }
  }
  return null;
}
