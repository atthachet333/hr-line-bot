import { google } from 'googleapis';

export async function getGoogleSheets() {
  // ดึงค่ากุญแจและแปลง \n ให้ขึ้นบรรทัดใหม่จริงๆ (สำคัญมากสำหรับ Private Key)
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], // สิทธิ์ในการแก้ไขไฟล์
  });

  const client = await auth.getClient();
  // @ts-ignore
  const googleSheets = google.sheets({ version: 'v4', auth: client });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  return { googleSheets, spreadsheetId };
}