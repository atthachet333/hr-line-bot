import { env } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';

/**
 * Load company holidays from the (optional) Holidays sheet.
 * Expected header: a `date` column with YYYY-MM-DD values.
 * Best-effort: returns an empty set if the sheet is absent or unreadable.
 */
export async function loadHolidays(): Promise<Set<string>> {
  if (!env.googleSheetId()) return new Set();
  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${env.sheetNames.holidays()}!A1:ZZ`,
    });
    const values = (res.data.values as string[][] | undefined) ?? [];
    if (values.length < 2) return new Set();
    const header = values[0];
    const dateIdx = header.indexOf('date');
    if (dateIdx === -1) return new Set();
    const set = new Set<string>();
    for (let r = 1; r < values.length; r++) {
      const raw = (values[r][dateIdx] ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) set.add(raw);
    }
    return set;
  } catch {
    return new Set();
  }
}
