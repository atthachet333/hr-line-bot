// Import ONLY the Sheets API surface (not the ~200MB monolithic `googleapis`
// barrel). Pulling in `{ google }` loads every Google API's type definitions
// into a single tsc program and OOMs `next build` / `tsc` on low-RAM hosts.
// `auth` here is the same AuthPlus instance that `google.auth` exposes, so the
// runtime behaviour is identical.
import { sheets, auth } from 'googleapis/build/src/apis/sheets';

export async function getGoogleSheets() {
  // ดึงค่ากุญแจและแปลง \n ให้ขึ้นบรรทัดใหม่จริงๆ (สำคัญมากสำหรับ Private Key)
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  const googleAuth = new auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], // สิทธิ์ในการแก้ไขไฟล์
  });

  const client = await googleAuth.getClient();
  // @ts-expect-error googleapis' GoogleAuth client type is not assignable to the sheets() auth param
  const googleSheets = sheets({ version: 'v4', auth: client });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  return { googleSheets, spreadsheetId };
}