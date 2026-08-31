import { randomUUID } from 'crypto';
import { env } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';
import {
  LEAVE_EVIDENCE_COLUMNS,
  type LeaveEvidenceRecord,
} from '@/lib/evidence/types';

function sheetName(): string {
  return env.sheetNames.leaveEvidence();
}

function toRow(record: LeaveEvidenceRecord, header: string[]): (string | number)[] {
  return header.map((column) => {
    if (!(column in record)) return '';
    return record[column as keyof LeaveEvidenceRecord];
  });
}

function fromRow(row: unknown[], index: Map<string, number>): LeaveEvidenceRecord {
  const value = (name: keyof LeaveEvidenceRecord): string => String(row[index.get(name) ?? -1] ?? '');
  return {
    evidenceId: value('evidenceId'),
    requestId: value('requestId'),
    employeeId: value('employeeId'),
    originalName: value('originalName'),
    storedName: value('storedName'),
    mimeType: value('mimeType'),
    size: Number(value('size')) || 0,
    relativePath: value('relativePath'),
    uploadedAt: value('uploadedAt'),
    status: value('status') === 'DELETED' ? 'DELETED' : 'AVAILABLE',
    sha256: value('sha256'),
  };
}

async function readHeader(): Promise<string[] | null> {
  const { sheets, spreadsheetId } = await getSheetsClient();
  const name = sheetName();
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${name}!1:1` });
    return (response.data.values?.[0] as string[] | undefined) ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Unable to parse range|not found/i.test(message)) throw error;
    return null;
  }
}

async function ensureSheet(): Promise<{ header: string[]; index: Map<string, number> }> {
  const { sheets, spreadsheetId } = await getSheetsClient();
  const name = sheetName();
  let header = await readHeader();
  if (header === null) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: name } } }] },
      });
    } catch (createError) {
      // Another process may have created the tab between get and addSheet.
      if (!/already exists/i.test(createError instanceof Error ? createError.message : String(createError))) {
        throw createError;
      }
    }
    header = [];
  }
  if (header.length === 0) {
    header = [...LEAVE_EVIDENCE_COLUMNS];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header] },
    });
  }
  const missing = LEAVE_EVIDENCE_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new Error(`LeaveEvidence sheet missing columns: ${missing.join(', ')}`);
  return { header, index: new Map(header.map((column, i) => [column, i])) };
}

export function generateEvidenceId(): string {
  return `EVD-${randomUUID().replace(/-/g, '').toUpperCase()}`;
}

/** Append all metadata rows in one Sheets request after every file is safely stored. */
export async function appendMany(records: LeaveEvidenceRecord[]): Promise<void> {
  if (records.length === 0) return;
  const { header } = await ensureSheet();
  const { sheets, spreadsheetId } = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName()}!A:ZZ`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: records.map((record) => toRow(record, header)) },
  });
}

export async function listByRequestId(requestId: string): Promise<LeaveEvidenceRecord[]> {
  // Reads are side-effect free. A deployment with legacy-only data does not
  // create/migrate a sheet merely because a manager opened an old request.
  const header = await readHeader();
  if (header === null || header.length === 0) return [];
  const missing = LEAVE_EVIDENCE_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new Error(`LeaveEvidence sheet missing columns: ${missing.join(', ')}`);
  const index = new Map(header.map((column, i) => [column, i]));
  const { sheets, spreadsheetId } = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName()}!A2:ZZ` });
  const rows = (response.data.values as unknown[][] | undefined) ?? [];
  return rows
    .map((row) => fromRow(row, index))
    .filter((item) => item.requestId === requestId && item.status === 'AVAILABLE')
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
}

export async function findByEvidenceId(requestId: string, evidenceId: string): Promise<LeaveEvidenceRecord | null> {
  const items = await listByRequestId(requestId);
  return items.find((item) => item.evidenceId === evidenceId) ?? null;
}
