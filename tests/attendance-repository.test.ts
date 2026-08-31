import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

/** In-memory Attendance sheet. store[0] is the header row. */
let store: unknown[][] = [];

const fakeSheets = {
  spreadsheets: {
    values: {
      get: vi.fn(async () => ({ data: { values: store } })),
      update: vi.fn(async (args: { requestBody: { values: unknown[][] } }) => {
        store[0] = [...args.requestBody.values[0]];
        return { data: {} };
      }),
      append: vi.fn(async (args: { requestBody: { values: unknown[][] } }) => {
        for (const row of args.requestBody.values) store.push(row);
        return { data: {} };
      }),
    },
    batchUpdate: vi.fn(async () => ({ data: {} })), // addSheet — no-op
  },
};

vi.mock('@/lib/sheets/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sheets/client')>('@/lib/sheets/client');
  return {
    ...actual,
    getSheetsClient: vi.fn(async () => ({ sheets: fakeSheets, spreadsheetId: 'sheet-1' })),
  };
});

import { recordAttendance } from '@/lib/attendance/attendance-repository';

const HEADER = ['timestamp', 'date', 'userId', 'displayName', 'type', 'time', 'lat', 'lng', 'summary', 'clientRequestId', 'empId'];
const iDate = HEADER.indexOf('date');
const iUser = HEADER.indexOf('userId');
const iType = HEADER.indexOf('type');
const iSummary = HEADER.indexOf('summary');
const iEmp = HEADER.indexOf('empId');
const TODAY = '2026-08-10';

function base(overrides: Record<string, unknown> = {}) {
  return {
    lineUserId: 'U-a',
    employeeId: 'S2A001',
    displayName: 'วิน',
    businessDate: TODAY,
    time: '09:00:00',
    lat: 13.7,
    lng: 100.5,
    ...overrides,
  };
}

beforeAll(() => {
  process.env.GOOGLE_SHEET_ID = 'sheet-1';
});

beforeEach(() => {
  vi.clearAllMocks();
  store = [HEADER.slice()];
});

describe('recordAttendance — Bug 1 (check-out finds check-in)', () => {
  it('#1 Employee A checks in, then A checks out successfully', async () => {
    const ci = await recordAttendance({ ...base(), type: 'checkin' });
    expect(ci.ok).toBe(true);
    const co = await recordAttendance({ ...base(), type: 'checkout', time: '18:00:00' });
    expect(co.ok).toBe(true);
    if (co.ok) expect(co.code).toBe('CHECK_OUT_RECORDED');
  });

  it('#5 open check-in (checkInAt, no checkout) → checkout passes', async () => {
    await recordAttendance({ ...base(), type: 'checkin' });
    const co = await recordAttendance({ ...base(), type: 'checkout' });
    expect(co.ok).toBe(true);
    if (co.ok) expect(co.diag.openCheckinFound).toBe(true);
  });

  it('#2 Employee B cannot use Employee A\'s check-in record', async () => {
    await recordAttendance({ ...base(), type: 'checkin' }); // A checks in
    const co = await recordAttendance({
      ...base(), type: 'checkout', lineUserId: 'U-b', employeeId: 'S2A002', displayName: 'บี',
    });
    expect(co.ok).toBe(false);
    if (!co.ok) expect(co.code).toBe('NOT_CHECKED_IN');
  });

  it('#6 checking out twice reports "already checked out" (not "not checked in")', async () => {
    await recordAttendance({ ...base(), type: 'checkin' });
    await recordAttendance({ ...base(), type: 'checkout' });
    const again = await recordAttendance({ ...base(), type: 'checkout', clientRequestId: 'x2' });
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe('ALREADY_CHECKED_OUT');
      expect(again.message).not.toContain('ยังไม่ได้เช็คอิน');
    }
  });

  it('#7 no check-in at all → "ยังไม่ได้เช็คอินวันนี้"', async () => {
    const co = await recordAttendance({ ...base(), type: 'checkout' });
    expect(co.ok).toBe(false);
    if (!co.ok) {
      expect(co.code).toBe('NOT_CHECKED_IN');
      expect(co.message).toContain('ยังไม่ได้เช็คอินวันนี้');
    }
  });

  it('#8 canonical: check-in keyed by EmpID is found even if the LINE id changed', async () => {
    await recordAttendance({ ...base(), type: 'checkin' }); // stores empId S2A001 + U-a
    // Same employee re-linked to a new LINE id — still matched by canonical EmpID.
    const co = await recordAttendance({ ...base(), type: 'checkout', lineUserId: 'U-a-new' });
    expect(co.ok).toBe(true);
  });

  it('writes date as plain YYYY-MM-DD text (never a coerced serial)', async () => {
    await recordAttendance({ ...base(), type: 'checkin' });
    const dataRow = store[store.length - 1];
    expect(dataRow[iDate]).toBe(TODAY);
    expect(typeof dataRow[iDate]).toBe('string');
    expect(dataRow[iEmp]).toBe('S2A001');
    expect(dataRow[iUser]).toBe('U-a');
    expect(dataRow[iType]).toBe('checkin');
  });

  it('finds a LEGACY row stored as a date-serial with no empId (root-cause regression)', async () => {
    const serial = Math.round((Date.UTC(2026, 7, 10) - Date.UTC(1899, 11, 30)) / 86_400_000);
    // Legacy header without empId; check-in row keyed only by LINE id + serial date.
    const legacyHeader = ['timestamp', 'date', 'userId', 'displayName', 'type', 'time', 'lat', 'lng', 'summary', 'clientRequestId'];
    const legacyRow: unknown[] = [];
    legacyRow[0] = '2026-08-10T02:00:00Z';
    legacyRow[legacyHeader.indexOf('date')] = serial; // stored as a number
    legacyRow[legacyHeader.indexOf('userId')] = 'U-a';
    legacyRow[legacyHeader.indexOf('type')] = 'checkin';
    store = [legacyHeader, legacyRow];

    const co = await recordAttendance({ ...base(), type: 'checkout' });
    expect(co.ok).toBe(true);
    if (co.ok) expect(co.diag.openCheckinFound).toBe(true);
  });

  it('is idempotent for a resubmitted clientRequestId (no duplicate row)', async () => {
    const first = await recordAttendance({ ...base(), type: 'checkin', clientRequestId: 'req-1' });
    expect(first.ok).toBe(true);
    const rowsAfterFirst = store.length;
    const replay = await recordAttendance({ ...base(), type: 'checkin', clientRequestId: 'req-1' });
    expect(replay.ok).toBe(true);
    expect(store.length).toBe(rowsAfterFirst); // no new row appended
  });

  it('returns NOT_CONFIGURED when GOOGLE_SHEET_ID is unset', async () => {
    const saved = process.env.GOOGLE_SHEET_ID;
    delete process.env.GOOGLE_SHEET_ID;
    const r = await recordAttendance({ ...base(), type: 'checkin' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_CONFIGURED');
    process.env.GOOGLE_SHEET_ID = saved;
  });
});

describe('recordAttendance — work summary persistence', () => {
  it('check-in does not require a summary and stores an empty summary cell', async () => {
    const ci = await recordAttendance({ ...base(), type: 'checkin' });
    expect(ci.ok).toBe(true);
    expect(store[store.length - 1][iSummary]).toBe('');
  });

  it('check-out stores the supplied summary in Attendance.summary', async () => {
    await recordAttendance({ ...base(), type: 'checkin' });
    await recordAttendance({ ...base(), type: 'checkout', summary: 'ปิดการขาย 3 ดีล' });
    expect(store[store.length - 1][iSummary]).toBe('ปิดการขาย 3 ดีล');
  });
});
