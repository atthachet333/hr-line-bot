/**
 * READ-ONLY diagnostic for the Employees sheet. Never writes anything.
 *
 * Surfaces the data conditions that make identity resolution fail for SOME
 * accounts but not others: blank / duplicate / whitespace / hidden-character
 * lineUserId, malformed ids, blank name, duplicate employeeId, blank
 * EmploymentType. LINE user ids are ALWAYS masked in the output.
 *
 * Usage:  npm run employees:diagnose
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

const LINE_ID_RE = /^U[0-9a-f]{32}$/i;

function describeHidden(raw: string): string[] {
  const notes: string[] = [];
  if (raw !== raw.trim()) notes.push('มีช่องว่างหน้า/หลัง');
  if (/[\r\n\t]/.test(raw)) notes.push('มี newline/tab');
  if (/[​-‍﻿ ]/.test(raw)) notes.push('มี zero-width/nbsp');
  const trimmed = raw.trim();
  if (trimmed && !LINE_ID_RE.test(trimmed)) notes.push('รูปแบบไม่ตรง U+32hex');
  return notes;
}

async function main() {
  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.error('❌ ต้องตั้งค่า GOOGLE_SHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY ก่อน');
    process.exit(1);
  }
  const { getSheetsClient } = await import('@/lib/sheets/client');
  const { env } = await import('@/lib/env');
  const { maskId } = await import('@/lib/utils/mask');

  const sheetName = env.sheetNames.employees();
  const { sheets, spreadsheetId } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A1:ZZ` });
  const values = (res.data.values as string[][] | undefined) ?? [];
  if (values.length === 0) { console.error(`❌ ชีต "${sheetName}" ว่างเปล่า`); process.exit(1); }

  const header = values[0].map((v) => String(v ?? '').trim());
  const col = (name: string) => header.indexOf(name);
  const iLine = col('lineUserId');
  const iEmp = col('employeeId');
  const iName = col('name');
  const iType = header.includes('EmploymentType') ? col('EmploymentType') : col('employmentType');
  const rows = values.slice(1);

  console.log('\nEmployees diagnostic (READ-ONLY)');
  console.log('='.repeat(60));
  console.log(`sheet        : ${sheetName}`);
  console.log(`header       : ${header.join(' | ')}`);
  console.log(`data rows    : ${rows.length}`);
  console.log(`columns      : lineUserId@${iLine} employeeId@${iEmp} name@${iName} employmentType@${iType}`);

  if (iLine === -1) { console.error('❌ ไม่พบคอลัมน์ lineUserId — หยุด'); process.exit(1); }

  let blankLine = 0, blankName = 0, blankType = 0, whitespaceIds = 0;
  const byTrimmedLine = new Map<string, number[]>();
  const byEmp = new Map<string, number[]>();
  const hiddenSamples: string[] = [];

  rows.forEach((row, i) => {
    const sheetRow = i + 2;
    const rawLine = String(row[iLine] ?? '');
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) blankLine++;
    else {
      byTrimmedLine.set(trimmedLine, [...(byTrimmedLine.get(trimmedLine) ?? []), sheetRow]);
      const notes = describeHidden(rawLine);
      if (notes.length) {
        whitespaceIds++;
        if (hiddenSamples.length < 10) hiddenSamples.push(`  row ${sheetRow}: ${maskId(trimmedLine)} — ${notes.join(', ')}`);
      }
    }
    if (iName !== -1 && !String(row[iName] ?? '').trim()) blankName++;
    if (iType !== -1 && !String(row[iType] ?? '').trim()) blankType++;
    if (iEmp !== -1) {
      const emp = String(row[iEmp] ?? '').trim().toUpperCase();
      if (emp) byEmp.set(emp, [...(byEmp.get(emp) ?? []), sheetRow]);
    }
  });

  const dupLine = [...byTrimmedLine.entries()].filter(([, r]) => r.length > 1);
  const dupEmp = [...byEmp.entries()].filter(([, r]) => r.length > 1);

  console.log('\n— ปัญหาที่อาจทำให้ identity resolve ไม่ได้ —');
  console.log(`blank lineUserId          : ${blankLine}`);
  console.log(`lineUserId มี whitespace/hidden char : ${whitespaceIds}`);
  if (hiddenSamples.length) console.log(hiddenSamples.join('\n'));
  console.log(`duplicate lineUserId groups: ${dupLine.length}`);
  for (const [id, r] of dupLine.slice(0, 10)) console.log(`  ${maskId(id)} → rows ${r.join(', ')}`);
  console.log(`duplicate employeeId groups: ${dupEmp.length}`);
  for (const [id, r] of dupEmp.slice(0, 10)) console.log(`  ${id.slice(0, 3)}*** → rows ${r.join(', ')}`);
  console.log(`blank name                 : ${blankName}`);
  console.log(`blank EmploymentType       : ${blankType} (ไม่ block การใช้งาน — optional)`);
  console.log('\n(ไม่มีการแก้ไขข้อมูลใดๆ — read only)');
  process.exit(0);
}

main().catch((err) => { console.error('❌ diagnose error:', err instanceof Error ? err.message : err); process.exit(1); });
