import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

/**
 * Regression guard for the EmploymentType change: the central employee lookup
 * must stay READ-ONLY and must never fail/throw because of the optional
 * EmploymentType column (the write-on-read broke Leave / Balance / History /
 * Attendance identity for already-linked accounts).
 */

let store: string[][] = [];
let updateShouldThrow = false;
const updateSpy = vi.fn();

const fakeSheets = {
  spreadsheets: {
    values: {
      get: vi.fn(async () => ({ data: { values: store } })),
      update: vi.fn(async (args: { range: string; requestBody: { values: string[][] } }) => {
        updateSpy(args);
        if (updateShouldThrow) throw new Error('The caller does not have permission (read-only)');
        return { data: {} };
      }),
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

import { findByLineUserId, findByEmployeeId } from '@/lib/repositories/employee-repository';

const PROD_HEADER = ['lineUserId', 'employeeId', 'name', 'position', 'department', 'managerLineUserId'];

beforeAll(() => {
  process.env.GOOGLE_SHEET_ID = 'sheet-1';
});

beforeEach(() => {
  vi.clearAllMocks();
  updateShouldThrow = false;
  store = [
    [...PROD_HEADER],
    ['U-001', 'S2A001', 'สมชาย ใจดี', 'Developer', 'IT', 'U-mgr'],
    ['U-007', 'S2A007', 'อาร์ม', 'QA', 'IT', ''],
  ];
});

describe('employee-repository — production header mapping (regression)', () => {
  it('#1-5 maps EmpID/LineUserID/Name/Position/Department/manager from the live camelCase header', async () => {
    const e = await findByLineUserId('U-001');
    expect(e).not.toBeNull();
    expect(e).toMatchObject({
      lineUserId: 'U-001',
      employeeId: 'S2A001',
      name: 'สมชาย ใจดี',
      position: 'Developer',
      department: 'IT',
      managerLineUserId: 'U-mgr',
    });
  });

  it('#11 findByLineUserId resolves an already-linked account (the core regression)', async () => {
    expect((await findByLineUserId('U-007'))?.employeeId).toBe('S2A007');
  });

  it('#12 findByEmployeeId resolves and normalises the id (trim + case)', async () => {
    const found = await findByEmployeeId('  s2a001 ');
    expect(found?.employee.employeeId).toBe('S2A001');
    expect(found?.rowNumber).toBe(2);
  });

  it('#13 identity is by lineUserId — a matching NAME never resolves the wrong row', async () => {
    // No row has this LINE id even though a name exists → must be null, not a name match.
    expect(await findByLineUserId('U-does-not-exist')).toBeNull();
  });
});

describe('employee-repository — EmploymentType is optional & lookup is read-only', () => {
  it('#6 lookup still succeeds when EmploymentType column is ABSENT', async () => {
    const e = await findByLineUserId('U-001');
    expect(e?.employeeId).toBe('S2A001');
    expect(e?.employmentType).toBe('');
  });

  it('#6b lookup NEVER fails even if the (best-effort) header append throws (read-only SA)', async () => {
    updateShouldThrow = true; // simulate a read-only service account
    const e = await findByLineUserId('U-001');
    // The regression made this return null / throw; it must resolve normally now.
    expect(e?.employeeId).toBe('S2A001');
  });

  it('#7 reads EmploymentType when the column exists (PascalCase)', async () => {
    store[0] = [...PROD_HEADER, 'EmploymentType'];
    store[1] = ['U-001', 'S2A001', 'สมชาย', 'Developer', 'IT', 'U-mgr', 'พนักงานประจำ'];
    const e = await findByLineUserId('U-001');
    expect(e?.employmentType).toBe('พนักงานประจำ');
  });

  it('#7b reads EmploymentType via the lowercase alias too', async () => {
    store[0] = [...PROD_HEADER, 'employmentType'];
    store[1] = ['U-001', 'S2A001', 'สมชาย', 'Developer', 'IT', 'U-mgr', 'พนักงานรายวัน'];
    const e = await findByLineUserId('U-001');
    expect(e?.employmentType).toBe('พนักงานรายวัน');
  });

  it('#9 when EmploymentType already exists, NO header write is attempted', async () => {
    store[0] = [...PROD_HEADER, 'EmploymentType'];
    await findByLineUserId('U-001');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('#10 tolerates surrounding whitespace in header cells', async () => {
    store[0] = [' lineUserId ', 'employeeId', ' name ', 'position', 'department', 'managerLineUserId'];
    const e = await findByLineUserId('U-001');
    expect(e?.employeeId).toBe('S2A001');
    expect(e?.name).toBe('สมชาย ใจดี');
  });

  it('the lookup path performs a READ (values.get), never a data write', async () => {
    await findByLineUserId('U-001');
    // get is the read; any update is only the isolated one-time header append,
    // which must never corrupt or rewrite existing data rows.
    expect(fakeSheets.spreadsheets.values.get).toHaveBeenCalled();
    for (const call of updateSpy.mock.calls) {
      // Only ever the single EmploymentType header cell — never a data row range.
      expect(call[0].range).toMatch(/![A-Z]+1$/);
    }
  });
});
