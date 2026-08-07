import { env } from '@/lib/env';
import {
  LEAVE_REQUEST_COLUMNS,
  LEAVE_REQUEST_NUMERIC_FIELDS,
  type LeaveRequest,
  type LeaveStatus,
  type NotificationStatus,
} from '@/lib/domain/leave-request';
import { nowIso, sheetDateToYmd } from '@/lib/utils/datetime';
import { columnLetter, getSheetsClient } from '@/lib/sheets/client';

function sheetName(): string {
  return env.sheetNames.leaveRequests();
}

const NUMERIC = new Set<string>(LEAVE_REQUEST_NUMERIC_FIELDS as string[]);

function defaultRecord(): LeaveRequest {
  return {
    requestId: '',
    clientRequestId: '',
    employeeLineUserId: '',
    employeeId: '',
    employeeName: '',
    position: '',
    department: '',
    leaveType: '',
    startDate: '',
    endDate: '',
    totalDays: 0,
    reason: '',
    managerLineUserId: '',
    status: 'PENDING',
    approvedBy: '',
    approvedByLineUserId: '',
    approvedAt: '',
    rejectedBy: '',
    rejectedByLineUserId: '',
    rejectedAt: '',
    rejectedReason: '',
    approvalSource: '',
    createdAt: '',
    updatedAt: '',
    managerNotificationStatus: 'NOT_STARTED',
    managerNotificationAttempts: 0,
    managerNotificationLastAttemptAt: '',
    managerNotificationError: '',
    employeeNotificationStatus: 'NOT_STARTED',
    employeeNotificationAttempts: 0,
    employeeNotificationLastAttemptAt: '',
    employeeNotificationError: '',
    evidenceStatus: 'NONE',
    evidenceOriginalFileName: '',
    evidenceStoredFileName: '',
    evidenceRelativePath: '',
    evidenceMimeType: '',
    evidenceSize: 0,
    evidenceUploadedAt: '',
    evidenceSha256: '',
  };
}

/** Build a row array positioned according to the ACTUAL sheet header. */
function toRow(req: LeaveRequest, header: string[]): (string | number)[] {
  return header.map((col) => {
    if (!(col in req)) return '';
    const value = req[col as keyof LeaveRequest];
    return value === undefined || value === null ? '' : (value as string | number);
  });
}

/** Calendar-date columns that must be normalised to YYYY-MM-DD on read. */
const DATE_FIELDS = new Set<string>(['startDate', 'endDate']);

/** Convert a sheet row (with header map) into a domain record. */
function fromRow(row: string[], headerIndex: Map<string, number>): LeaveRequest {
  const record = defaultRecord();
  for (const col of LEAVE_REQUEST_COLUMNS) {
    const idx = headerIndex.get(col);
    if (idx === undefined) continue;
    const raw = row[idx] ?? '';
    if (NUMERIC.has(col)) {
      (record[col] as number) = Number(raw) || 0;
    } else if (DATE_FIELDS.has(col)) {
      // Repair values Sheets coerced into a serial number (e.g. "46787") back to
      // a clean YYYY-MM-DD so every consumer formats the correct calendar date.
      (record[col] as string) = sheetDateToYmd(raw);
    } else {
      (record[col] as string) = String(raw);
    }
  }
  if (!record.status) record.status = 'PENDING';
  return record;
}

/** Ensure a header row exists. Never overwrites a non-empty (possibly custom) header. */
async function ensureHeaders(): Promise<{ header: string[]; headerIndex: Map<string, number> }> {
  const { sheets, spreadsheetId } = await getSheetsClient();
  const name = sheetName();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${name}!1:1` });
  let header = (res.data.values?.[0] as string[] | undefined) ?? [];

  if (header.length === 0) {
    header = LEAVE_REQUEST_COLUMNS as string[];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header] },
    });
  }

  return { header, headerIndex: new Map(header.map((h, i) => [h, i] as const)) };
}

async function readAll(): Promise<{
  rows: string[][];
  header: string[];
  headerIndex: Map<string, number>;
}> {
  const { header, headerIndex } = await ensureHeaders();
  const { sheets, spreadsheetId } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName()}!A2:ZZ`,
  });
  return { rows: (res.data.values as string[][] | undefined) ?? [], header, headerIndex };
}

export interface FoundRequest {
  request: LeaveRequest;
  /** 1-based sheet row number (header is row 1). */
  rowNumber: number;
  header: string[];
}

async function findBy(predicate: (r: LeaveRequest) => boolean): Promise<FoundRequest | null> {
  const { rows, header, headerIndex } = await readAll();
  for (let i = 0; i < rows.length; i++) {
    const request = fromRow(rows[i], headerIndex);
    if (predicate(request)) {
      return { request, rowNumber: i + 2, header };
    }
  }
  return null;
}

export function findByRequestId(requestId: string): Promise<FoundRequest | null> {
  return findBy((r) => r.requestId === requestId);
}

/** Idempotency lookup by (employeeLineUserId + clientRequestId). */
export function findByIdempotencyKey(
  employeeLineUserId: string,
  clientRequestId: string,
): Promise<FoundRequest | null> {
  if (!clientRequestId) return Promise.resolve(null);
  return findBy(
    (r) => r.clientRequestId === clientRequestId && r.employeeLineUserId === employeeLineUserId,
  );
}

/** Canonical employee-id compare (trim + uppercase); '' never matches. */
function sameEmployeeId(a: string, b: string): boolean {
  const na = (a ?? '').trim().toUpperCase();
  const nb = (b ?? '').trim().toUpperCase();
  return na !== '' && na === nb;
}

/**
 * Is `row` the SAME employee as the submitter? Matched by canonical employeeId
 * (primary) OR verified LINE user id — a blank identity NEVER matches, so a
 * different employee (or a legacy row with a blank id) can never block another
 * person's leave. Identity is never compared by name.
 */
function isSameEmployeeRow(row: LeaveRequest, lineUserId: string, employeeId: string): boolean {
  if (sameEmployeeId(row.employeeId, employeeId)) return true;
  if (lineUserId && row.employeeLineUserId && row.employeeLineUserId === lineUserId) return true;
  return false;
}

/**
 * Find an ACTIVE request of the SAME employee whose date range overlaps
 * [startDate,endDate]. Only the submitter's own PENDING/APPROVED requests block;
 * REJECTED/CANCELLED never do. Other employees are never considered.
 */
export async function findOverlapping(
  employeeLineUserId: string,
  employeeId: string,
  startDate: string,
  endDate: string,
  activeStatuses: LeaveStatus[] = ['PENDING', 'APPROVED'],
): Promise<LeaveRequest | null> {
  const { rows, headerIndex } = await readAll();
  const s = Date.parse(`${startDate}T00:00:00Z`);
  const e = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  for (const row of rows) {
    const r = fromRow(row, headerIndex);
    if (!isSameEmployeeRow(r, employeeLineUserId, employeeId)) continue;
    if (!activeStatuses.includes(r.status)) continue;
    const rs = Date.parse(`${r.startDate}T00:00:00Z`);
    const re = Date.parse(`${r.endDate}T00:00:00Z`);
    if (Number.isNaN(rs) || Number.isNaN(re)) continue;
    if (s <= re && rs <= e) return r; // inclusive range intersection
  }
  return null;
}

/**
 * List all leave requests belonging to a verified employee, most-recent first.
 *
 * The primary key is `employeeLineUserId` (the server-verified LINE user id).
 * `employeeId` is used ONLY as a fallback for legacy rows that were written
 * before the LINE id was captured — and only when the row's `employeeLineUserId`
 * is blank AND its `employeeId` matches the already-verified employee. Identity
 * is never taken from the request; callers pass values resolved from the token +
 * Employees sheet.
 */
export async function listForEmployee(
  employeeLineUserId: string,
  employeeId: string,
): Promise<LeaveRequest[]> {
  const { rows, headerIndex } = await readAll();
  const items: LeaveRequest[] = [];
  for (const row of rows) {
    const r = fromRow(row, headerIndex);
    const matchByLine = !!employeeLineUserId && r.employeeLineUserId === employeeLineUserId;
    const matchByLegacyId = !r.employeeLineUserId && !!employeeId && r.employeeId === employeeId;
    if (matchByLine || matchByLegacyId) items.push(r);
  }
  // Newest first by createdAt (ISO 8601 sorts lexicographically). Fall back to
  // updatedAt when createdAt is missing on older rows.
  items.sort((a, b) => {
    const ka = a.createdAt || a.updatedAt;
    const kb = b.createdAt || b.updatedAt;
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  return items;
}

/** Return every leave request (used by maintenance scripts). */
export async function listAllRequests(): Promise<LeaveRequest[]> {
  const { rows, headerIndex } = await readAll();
  return rows.map((row) => fromRow(row, headerIndex));
}

/** Append a new leave request row. */
export async function create(req: LeaveRequest): Promise<void> {
  const { header } = await ensureHeaders();
  const { sheets, spreadsheetId } = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName()}!A:ZZ`,
    // RAW (not USER_ENTERED): keep "2026-08-06" as literal text so Sheets never
    // coerces dates into serial numbers (the "1 มกราคม 46787" bug).
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [toRow(req, header)] },
  });
}

/** Overwrite an existing row (identified by its row number) with a full record. */
async function writeRow(rowNumber: number, req: LeaveRequest, header: string[]): Promise<void> {
  const { sheets, spreadsheetId } = await getSheetsClient();
  const lastCol = columnLetter(header.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName()}!A${rowNumber}:${lastCol}${rowNumber}`,
    // RAW so dates stay literal text (never coerced to serial numbers).
    valueInputOption: 'RAW',
    requestBody: { values: [toRow(req, header)] },
  });
}

export type TransitionResult =
  | { ok: true; request: LeaveRequest }
  | { ok: false; reason: 'not_found' | 'already_processed'; current?: LeaveRequest };

/**
 * Conditionally transition a request out of PENDING. Re-reads the row immediately
 * before writing and only applies the change when the current status is still
 * PENDING. NOTE: this is a best-effort guard (read-check-write). For true atomic
 * transitions across processes use the Apps Script LockService endpoint via
 * `atomicTransition`. Kept as a fallback + for tests.
 */
export async function transitionFromPending(
  requestId: string,
  patch: Partial<LeaveRequest> & { status: Extract<LeaveStatus, 'APPROVED' | 'REJECTED'> },
): Promise<TransitionResult> {
  const found = await findByRequestId(requestId);
  if (!found) return { ok: false, reason: 'not_found' };
  if (found.request.status !== 'PENDING') {
    return { ok: false, reason: 'already_processed', current: found.request };
  }
  const updated: LeaveRequest = { ...found.request, ...patch, updatedAt: nowIso() };
  await writeRow(found.rowNumber, updated, found.header);
  return { ok: true, request: updated };
}

/** Update only the evidence-metadata fields for a request. */
export async function setEvidenceMetadata(
  requestId: string,
  meta: Partial<import('@/lib/evidence/types').EvidenceMetadata>,
): Promise<void> {
  const found = await findByRequestId(requestId);
  if (!found) return;
  await writeRow(found.rowNumber, { ...found.request, ...meta, updatedAt: nowIso() }, found.header);
}

/** Apply an arbitrary patch to a request by id (best-effort; no status guard). */
export async function patchByRequestId(
  requestId: string,
  patch: Partial<LeaveRequest>,
): Promise<LeaveRequest | null> {
  const found = await findByRequestId(requestId);
  if (!found) return null;
  const updated: LeaveRequest = { ...found.request, ...patch, updatedAt: nowIso() };
  await writeRow(found.rowNumber, updated, found.header);
  return updated;
}

export interface NotificationUpdate {
  status: NotificationStatus;
  error?: string;
  incrementAttempt?: boolean;
}

/** Update manager-notification tracking fields. */
export async function setManagerNotification(
  requestId: string,
  update: NotificationUpdate,
): Promise<void> {
  const found = await findByRequestId(requestId);
  if (!found) return;
  const patch: Partial<LeaveRequest> = {
    managerNotificationStatus: update.status,
    managerNotificationError: update.error ?? '',
    managerNotificationLastAttemptAt: nowIso(),
  };
  if (update.incrementAttempt) {
    patch.managerNotificationAttempts = (found.request.managerNotificationAttempts ?? 0) + 1;
  }
  await writeRow(found.rowNumber, { ...found.request, ...patch, updatedAt: nowIso() }, found.header);
}

/** Update employee-notification tracking fields. */
export async function setEmployeeNotification(
  requestId: string,
  update: NotificationUpdate,
): Promise<void> {
  const found = await findByRequestId(requestId);
  if (!found) return;
  const patch: Partial<LeaveRequest> = {
    employeeNotificationStatus: update.status,
    employeeNotificationError: update.error ?? '',
    employeeNotificationLastAttemptAt: nowIso(),
  };
  if (update.incrementAttempt) {
    patch.employeeNotificationAttempts = (found.request.employeeNotificationAttempts ?? 0) + 1;
  }
  await writeRow(found.rowNumber, { ...found.request, ...patch, updatedAt: nowIso() }, found.header);
}
