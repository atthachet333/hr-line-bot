/**
 * One-time migration: REORDER the columns of the Attendance sheet to a fixed
 * target order — moving each column together with all of its data. Row order and
 * cell values are preserved exactly; nothing is deleted.
 *
 * SAFETY MODEL
 *  - Dry-run by DEFAULT. Nothing is written without `--confirm`.
 *  - On --confirm: a full backup tab (duplicateSheet, an exact clone incl.
 *    formats) is created FIRST and verified before the Attendance sheet is
 *    rewritten. If the backup fails, the migration aborts before any write.
 *  - Reorder is by HEADER NAME → source index (never a hard-coded position).
 *  - Unknown/extra columns are never dropped: they are preserved, in their
 *    original order, AFTER the 13 target columns.
 *  - Reads use UNFORMATTED_VALUE and writes use RAW so stored values round-trip
 *    unchanged (text stays text, numbers/date-serials stay numbers — exactly
 *    what the app's sheetDateToYmd/parseSheetDate already handle).
 *
 * Usage:
 *   npm run attendance:migrate-columns              # dry-run (no writes)
 *   npm run attendance:migrate-columns -- --confirm # perform the migration
 */
import { existsSync, readFileSync } from 'fs';

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv('.env.local');
loadDotEnv('.env');

/** Target column order requested for the Attendance sheet. */
const TARGET_HEADER = [
  'timestamp',
  'date',
  'empId',
  'displayName',
  'type',
  'time',
  'workHours',
  'lat',
  'lng',
  'summary',
  'employmentType',
  'userId',
  'clientRequestId',
] as const;

/** Backup tab name stamped in Asia/Bangkok. */
function backupTabName(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `Attendance_Backup_${get('year')}${get('month')}${get('day')}_${get('hour')}${get('minute')}${get('second')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');

  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.error('❌ ต้องตั้งค่า GOOGLE_SHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY ก่อน');
    process.exit(1);
  }

  const { getSheetsClient } = await import('@/lib/sheets/client');
  const { env } = await import('@/lib/env');
  const { maskId, maskEmployeeId } = await import('@/lib/utils/mask');
  const { reorderAttendanceMatrix } = await import('@/lib/attendance/column-migration');

  const sheetName = env.sheetNames.attendance();
  const { sheets, spreadsheetId } = await getSheetsClient();

  // ---- Locate the Attendance tab (need its sheetId for duplicateSheet) --------
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const attendanceSheet = (meta.data.sheets ?? []).find((s) => s.properties?.title === sheetName);
  if (!attendanceSheet?.properties) {
    console.error(`❌ ไม่พบชีต "${sheetName}" ในสเปรดชีต`);
    process.exit(1);
  }
  const sourceSheetId = attendanceSheet.properties.sheetId as number;

  // ---- Read the whole sheet faithfully ---------------------------------------
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:ZZ`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = (res.data.values as unknown[][] | undefined) ?? [];
  if (values.length === 0) {
    console.error(`❌ ชีต "${sheetName}" ว่างเปล่า — ไม่มีอะไรให้ย้าย`);
    process.exit(1);
  }

  const header = (values[0] ?? []).map((v) => String(v ?? '').trim());
  const dataRows = values.slice(1);

  // ---- Pure reorder (header-name → source index; extras preserved) -----------
  const plan = reorderAttendanceMatrix(values, TARGET_HEADER);
  const { finalHeader, rows: reorderedRows, missingColumns, extraColumns, duplicateTargets } = plan;
  const outValues = plan.values;

  // ---- Duplicate-target-header guard (ambiguous mapping) ----------------------
  if (duplicateTargets.length > 0) {
    console.error(`❌ พบ header ซ้ำสำหรับคอลัมน์เป้าหมาย: ${duplicateTargets.join(', ')} — หยุดเพื่อความปลอดภัย (แก้ header ซ้ำก่อน)`);
    process.exit(1);
  }

  const cellAt = (row: unknown[], idx: number): unknown => (idx === -1 || idx >= row.length ? '' : (row[idx] ?? ''));

  // ---- Report -----------------------------------------------------------------
  const backupName = backupTabName();
  const mask = (name: string, v: unknown): string => {
    const s = String(v ?? '');
    if (name === 'userId') return s ? maskId(s) : '(ว่าง)';
    if (name === 'empId') return s ? maskEmployeeId(s) : '(ว่าง)';
    return s;
  };
  const sampleRow = (row: unknown[], hdr: string[]) =>
    ['timestamp', 'date', 'empId', 'displayName', 'type', 'time', 'userId', 'clientRequestId']
      .map((name) => `${name}=${mask(name, cellAt(row, hdr.indexOf(name)))}`)
      .join(' | ');

  console.log('\nAttendance column migration');
  console.log('='.repeat(64));
  console.log(`sheet                : ${sheetName}`);
  console.log(`data rows            : ${dataRows.length}`);
  console.log(`\ncurrent header (${header.length}):`);
  console.log(`  ${header.join(' | ')}`);
  console.log(`\ntarget header (${TARGET_HEADER.length}):`);
  console.log(`  ${TARGET_HEADER.join(' | ')}`);
  console.log(`\nfinal header after migration (${finalHeader.length}):`);
  console.log(`  ${finalHeader.join(' | ')}`);
  console.log(`\nmissing target columns : ${missingColumns.length ? missingColumns.join(', ') + ' (จะเพิ่มเป็นคอลัมน์ว่าง)' : '(ไม่มี)'}`);
  console.log(`extra columns (kept)   : ${extraColumns.length ? extraColumns.map((c) => `"${c.name || '(ไม่มีชื่อ)'}"[col ${c.index}]`).join(', ') : '(ไม่มี)'}`);
  console.log(`proposed backup tab    : ${backupName}`);

  if (dataRows.length > 0) {
    console.log('\nsample validation (masked) — before → after (ค่าต้องตรงกัน):');
    const idxs = dataRows.length === 1 ? [0] : [0, dataRows.length - 1];
    for (const i of idxs) {
      console.log(`  row ${i + 2} before: ${sampleRow(dataRows[i], header)}`);
      console.log(`  row ${i + 2} after : ${sampleRow(reorderedRows[i], finalHeader)}`);
    }
  }

  if (!confirm) {
    console.log('\n⚠️  โหมดตรวจสอบ (dry-run) — ยังไม่ได้เขียนอะไรลงชีต');
    console.log('    ถ้าถูกต้องแล้ว รันซ้ำพร้อม --confirm เพื่อทำ migration จริง:');
    console.log('    npm run attendance:migrate-columns -- --confirm');
    process.exit(0);
  }

  // ---- CONFIRM: backup first, verify, then rewrite ---------------------------
  console.log(`\n🔒 กำลังสร้าง backup: ${backupName} ...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ duplicateSheet: { sourceSheetId, newSheetName: backupName } }] },
  });

  const backupRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${backupName}!A1:ZZ`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const backupValues = (backupRes.data.values as unknown[][] | undefined) ?? [];
  if (backupValues.length !== values.length) {
    console.error(`❌ backup ไม่ครบ (backup ${backupValues.length} แถว ≠ ต้นฉบับ ${values.length} แถว) — ยกเลิก ไม่แตะ Attendance`);
    process.exit(1);
  }
  console.log(`✅ backup สำเร็จ: ${backupValues.length} แถว (รวม header) — ตรงกับต้นฉบับ`);

  console.log('\n✍️  กำลังเขียนลำดับคอลัมน์ใหม่ลง Attendance ...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: outValues },
  });

  // ---- Verify the result ------------------------------------------------------
  const afterRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:ZZ`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const afterValues = (afterRes.data.values as unknown[][] | undefined) ?? [];
  const afterHeader = (afterValues[0] ?? []).map((v) => String(v ?? '').trim());

  const headerOk = afterHeader.join('') === finalHeader.join('');
  const rowCountOk = afterValues.length === values.length;
  console.log('\nverification:');
  console.log(`  header order : ${headerOk ? '✅ ตรง target' : '❌ ไม่ตรง'}`);
  console.log(`  row count    : ${rowCountOk ? '✅' : '❌'} ${afterValues.length - 1} data rows`);
  if (afterValues.length > 1) {
    console.log(`  row 2 after  : ${sampleRow(afterValues[1], afterHeader)}`);
  }

  if (!headerOk || !rowCountOk) {
    console.error(`\n❌ การตรวจสอบไม่ผ่าน — ข้อมูลเดิมยังอยู่ครบใน backup: ${backupName}`);
    process.exit(1);
  }

  console.log(`\n✅ migration สำเร็จ — Attendance ถูกจัดลำดับคอลัมน์ใหม่แล้ว (backup: ${backupName})`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ migration error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
