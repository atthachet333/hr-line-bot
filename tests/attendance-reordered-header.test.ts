import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

/**
 * After the column migration, the Attendance sheet header is in the TARGET
 * order. The repository reads/writes by header NAME, so everything must still
 * map to the right column. This guards that promise.
 */
const TARGET = ['timestamp', 'date', 'empId', 'displayName', 'type', 'time', 'workHours', 'lat', 'lng', 'summary', 'employmentType', 'userId', 'clientRequestId'];
const at = (name: string) => TARGET.indexOf(name);

let store: unknown[][] = [];

const fakeSheets = {
  spreadsheets: {
    values: {
      get: vi.fn(async () => ({ data: { values: store } })),
      update: vi.fn(async (args: { requestBody: { values: unknown[][] } }) => { store[0] = [...args.requestBody.values[0]]; return { data: {} }; }),
      append: vi.fn(async (args: { requestBody: { values: unknown[][] } }) => { for (const row of args.requestBody.values) store.push(row); return { data: {} }; }),
    },
    batchUpdate: vi.fn(async () => ({ data: {} })),
  },
};

vi.mock('@/lib/sheets/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sheets/client')>('@/lib/sheets/client');
  return { ...actual, getSheetsClient: vi.fn(async () => ({ sheets: fakeSheets, spreadsheetId: 'sheet-1' })) };
});

import { recordAttendance, getAttendanceHistory } from '@/lib/attendance/attendance-repository';

const TODAY = '2026-08-10';
function base(o: Record<string, unknown> = {}) {
  return { lineUserId: 'U-a', employeeId: 'S2A001', displayName: 'วิน', businessDate: TODAY, time: '08:30', lat: 13.7, lng: 100.5, employmentType: 'พนักงานประจำ', ...o };
}

beforeAll(() => { process.env.GOOGLE_SHEET_ID = 'sheet-1'; });
beforeEach(() => { vi.clearAllMocks(); store = [TARGET.slice()]; });

describe('repository against the reordered (target) header', () => {
  it('#7 check-in appends values into the correct target columns', async () => {
    const r = await recordAttendance({ ...base(), type: 'checkin' });
    expect(r.ok).toBe(true);
    const row = store[store.length - 1];
    expect(row[at('empId')]).toBe('S2A001');
    expect(row[at('userId')]).toBe('U-a');
    expect(row[at('displayName')]).toBe('วิน');
    expect(row[at('type')]).toBe('checkin');
    expect(row[at('date')]).toBe(TODAY);
    expect(row[at('time')]).toBe('08:30');
    expect(row[at('employmentType')]).toBe('พนักงานประจำ');
    expect(row[at('lat')]).toBe(13.7);
  });

  it('#8 check-out writes workHours into the workHours column', async () => {
    await recordAttendance({ ...base(), type: 'checkin', time: '08:30' });
    const co = await recordAttendance({ ...base(), type: 'checkout', time: '17:45' });
    expect(co.ok).toBe(true);
    const row = store[store.length - 1];
    expect(row[at('type')]).toBe('checkout');
    expect(row[at('workHours')]).toBe('9.25'); // 08:30→17:45
    expect(row[at('empId')]).toBe('S2A001');
    expect(row[at('userId')]).toBe('U-a');
  });

  it('#9 history reads correctly from the reordered header', async () => {
    await recordAttendance({ ...base(), type: 'checkin', time: '08:30' });
    await recordAttendance({ ...base(), type: 'checkout', time: '17:30' });
    const items = await getAttendanceHistory({ lineUserId: 'U-a', employeeId: 'S2A001', employmentType: 'พนักงานประจำ', month: 8, year: 2026 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ date: TODAY, checkin: '08:30', checkout: '17:30', workHours: 9, status: 'complete' });
  });

  it('legacy row with the OLD order is still matched (header-name based)', async () => {
    const OLD = ['timestamp', 'date', 'userId', 'displayName', 'type', 'time', 'lat', 'lng', 'summary', 'clientRequestId', 'empId', 'employmentType', 'workHours'];
    const row: unknown[] = OLD.map(() => '');
    row[OLD.indexOf('date')] = TODAY;
    row[OLD.indexOf('userId')] = 'U-a';
    row[OLD.indexOf('type')] = 'checkin';
    row[OLD.indexOf('time')] = '08:00';
    // The sheet currently has the OLD header + this legacy row.
    store = [OLD, row];
    const items = await getAttendanceHistory({ lineUserId: 'U-a', employeeId: 'S2A001', employmentType: '', month: 8, year: 2026 });
    expect(items).toHaveLength(1);
    expect(items[0].checkin).toBe('08:00');
  });
});
