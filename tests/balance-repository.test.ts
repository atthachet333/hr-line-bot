import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

/** In-memory Balances sheet. store[0] is the header row. */
let store: unknown[][] = [];

const fakeSheets = {
  spreadsheets: {
    values: {
      get: vi.fn(async () => ({ data: { values: store } })),
    },
  },
};

vi.mock('@/lib/sheets/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sheets/client')>('@/lib/sheets/client');
  return {
    ...actual,
    getSheetsClient: vi.fn(async () => ({ sheets: fakeSheets, spreadsheetId: 'sheet-1' })),
  };
});

import { findEntitlements } from '@/lib/repositories/balance-repository';

beforeAll(() => {
  process.env.GOOGLE_SHEET_ID = 'sheet-1';
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findEntitlements (strict employeeId key)', () => {
  it('reads 30/6/6 from the English contract header', async () => {
    store = [
      ['employeeId', 'sick', 'business', 'annual'],
      ['S2A001', 30, 6, 6],
      ['S2A007', 30, 6, 6],
    ];
    const r = await findEntitlements('S2A007');
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.entitlements).toEqual({ sick: 30, business: 6, annual: 6 });
  });

  it('supports the live sheet header (EmpID / SickLeave / PersonalLeave / AnnualLeave)', async () => {
    store = [
      ['LineUserID', 'Name', 'SickLeave', 'PersonalLeave', 'AnnualLeave', 'EmpID'],
      ['U-x', 'วิน', 30, 6, 6, 'S2A001'],
    ];
    const r = await findEntitlements('S2A001');
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.entitlements).toEqual({ sick: 30, business: 6, annual: 6 });
  });

  it('supports Thai headers', async () => {
    store = [
      ['รหัสพนักงาน', 'ลาป่วย', 'ลากิจ', 'ลาพักร้อน'],
      ['S2A001', 30, 6, 6],
    ];
    const r = await findEntitlements('S2A001');
    if (r.status === 'ok') expect(r.entitlements).toEqual({ sick: 30, business: 6, annual: 6 });
  });

  it('parses numeric strings', async () => {
    store = [
      ['employeeId', 'sick', 'business', 'annual'],
      ['S2A001', '30', '6', '6.5'],
    ];
    const r = await findEntitlements('S2A001');
    if (r.status === 'ok') expect(r.entitlements).toEqual({ sick: 30, business: 6, annual: 6.5 });
  });

  it('matches by employeeId ONLY — never by lineUserId', async () => {
    store = [
      ['LineUserID', 'SickLeave', 'PersonalLeave', 'AnnualLeave', 'EmpID'],
      ['U-real', 30, 6, 6, 'S2AIT001'], // EmpID differs from the queried id
    ];
    // Even though a LineUserID column exists, querying S2A001 must NOT match.
    const r = await findEntitlements('S2A001');
    expect(r.status).toBe('not_found');
  });

  it('returns not_found when no row matches', async () => {
    store = [['employeeId', 'sick', 'business', 'annual'], ['S2A001', 30, 6, 6]];
    expect((await findEntitlements('S2A999')).status).toBe('not_found');
  });

  it('flags a blank entitlement as invalid (not 0)', async () => {
    store = [
      ['employeeId', 'sick', 'business', 'annual'],
      ['S2A001', 30, '', 6],
    ];
    const r = await findEntitlements('S2A001');
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.fields.business).toBe(false);
  });

  it('flags a non-numeric entitlement as invalid', async () => {
    store = [['employeeId', 'sick', 'business', 'annual'], ['S2A001', 'thirty', 6, 6]];
    expect((await findEntitlements('S2A001')).status).toBe('invalid');
  });

  it('flags duplicate employeeId rows', async () => {
    store = [
      ['employeeId', 'sick', 'business', 'annual'],
      ['S2A001', 30, 6, 6],
      ['S2A001', 10, 2, 2],
    ];
    const r = await findEntitlements('S2A001');
    expect(r.status).toBe('duplicate');
    if (r.status === 'duplicate') expect(r.count).toBe(2);
  });

  it('treats zero as a valid entitlement', async () => {
    store = [['employeeId', 'sick', 'business', 'annual'], ['S2A001', 0, 0, 0]];
    const r = await findEntitlements('S2A001');
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.entitlements).toEqual({ sick: 0, business: 0, annual: 0 });
  });
});
