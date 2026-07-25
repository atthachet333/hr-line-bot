import { env } from '@/lib/env';
import {
  LEAVE_REQUEST_COLUMNS,
  LEAVE_REQUEST_NUMERIC_FIELDS,
  type LeaveRequest,
  type LeaveStatus,
  type NotificationStatus,
} from '@/lib/domain/leave-request';
import { nowIso } from '@/lib/utils/datetime';
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
    approvedAt: '',
    rejectedBy: '',
    rejectedAt: '',
    rejectedReason: '',
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

/** Convert a sheet row (with header map) into a domain record. */
function fromRow(row: string[], headerIndex: Map<string, number>): LeaveRequest {
  const record = defaultRecord();
  for (const col of LEAVE_REQUEST_COLUMNS) {
    const idx = headerIndex.get(col);
    if (idx === undefined) continue;
    const raw = row[idx] ?? '';
    if (NUMERIC.has(col)) {
      (record[col] as number) = Number(raw) || 0;
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

/** Find any request for an employee that overlaps [startDate,endDate] and is active. */
export async function findOverlapping(
  employeeLineUserId: string,
  startDate: string,
  endDate: string,
  activeStatuses: LeaveStatus[] = ['PENDING', 'APPROVED'],
): Promise<LeaveRequest | null> {
  const { rows, headerIndex } = await readAll();
  const s = Date.parse(`${startDate}T00:00:00Z`);
  const e = Date.parse(`${endDate}T00:00:00Z`);
  for (const row of rows) {
    const r = fromRow(row, headerIndex);
    if (r.employeeLineUserId !== employeeLineUserId) continue;
    if (!activeStatuses.includes(r.status)) continue;
    const rs = Date.parse(`${r.startDate}T00:00:00Z`);
    const re = Date.parse(`${r.endDate}T00:00:00Z`);
    if (Number.isNaN(rs) || Number.isNaN(re)) continue;
    if (s <= re && rs <= e) return r; // ranges intersect
  }
  return null;
}

/** Append a new leave request row. */
export async function create(req: LeaveRequest): Promise<void> {
  const { header } = await ensureHeaders();
  const { sheets, spreadsheetId } = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName()}!A:ZZ`,
    valueInputOption: 'USER_ENTERED',
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
    valueInputOption: 'USER_ENTERED',
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
