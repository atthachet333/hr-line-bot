// Import ONLY the Sheets API surface, not the ~200MB monolithic `googleapis`
// barrel, so `tsc` / `next build` do not load every Google API's types (OOM on
// low-RAM hosts). `auth`/`sheets` come from the same googleapis version as
// before, so behaviour is unchanged.
import { sheets as sheetsApi, auth as googleAuth, type sheets_v4 } from 'googleapis/build/src/apis/sheets';
import { env } from '@/lib/env';

let cached: { sheets: sheets_v4.Sheets; spreadsheetId: string } | null = null;

/**
 * Authenticated Google Sheets client (service account). The spreadsheet id comes
 * from GOOGLE_SHEET_ID. Cached for the lifetime of the server process.
 */
export async function getSheetsClient(): Promise<{
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
}> {
  if (cached) return cached;

  const spreadsheetId = env.googleSheetId();
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID is not configured');
  }

  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const auth = new googleAuth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = sheetsApi({ version: 'v4', auth });
  cached = { sheets, spreadsheetId };
  return cached;
}

/** A1 column letter for a zero-based column index (0 -> A, 26 -> AA). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letter = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}
