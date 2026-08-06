import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

/** In-memory Employees sheet. store[0] is the header row. */
const HEADER = ['lineUserId', 'employeeId', 'name', 'position', 'department', 'managerLineUserId'];
const store: string[][] = [];

function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const fakeSheets = {
  spreadsheets: {
    values: {
      get: vi.fn(async ({ range }: { range: string }) => {
        if (/!1:1$/.test(range)) return { data: { values: store.length ? [store[0]] : [] } };
        return { data: { values: store } }; // A1:ZZ
      }),
      update: vi.fn(async ({ range, requestBody }: { range: string; requestBody: { values: string[][] } }) => {
        const m = range.match(/!([A-Z]+)(\d+)$/);
        if (m) {
          const col = colToIndex(m[1]);
          const row = Number(m[2]) - 1;
          if (!store[row]) store[row] = [];
          store[row][col] = requestBody.values[0][0];
        }
        return {};
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

import * as repo from '@/lib/repositories/employee-repository';

beforeAll(() => {
  process.env.GOOGLE_SHEET_ID = 'sheet-1';
});

beforeEach(() => {
  store.length = 0;
  store.push([...HEADER]);
  store.push(['U-001', 'S2A001', 'สมชาย', 'dev', 'IT', '']);
  store.push(['U-WRONG', 'S2A007', 'อาร์ม', 'dev', 'IT', '']); // HR typed a wrong LINE id
  store.push(['', 'S2A099', 'ใหม่', 'qa', 'QA', '']); // never linked
});

describe('employee link/unlink', () => {
  it('links a blank row and is then found by lineUserId', async () => {
    const r = await repo.linkEmployee('S2A099', 'U-new');
    expect(r.status).toBe('linked');
    const found = await repo.findByLineUserId('U-new');
    expect(found?.employeeId).toBe('S2A099');
  });

  it('normalises the employeeId (trim + uppercase)', async () => {
    const r = await repo.linkEmployee('  s2a099 ', 'U-new2');
    expect(r.status).toBe('linked');
  });

  it('returns employee_not_found for an unknown employeeId', async () => {
    const r = await repo.linkEmployee('NOPE', 'U-x');
    expect(r.status).toBe('employee_not_found');
  });

  it('refuses to overwrite a row already linked to another LINE user', async () => {
    const r = await repo.linkEmployee('S2A007', 'U-someone-else');
    expect(r.status).toBe('employee_already_linked');
    // The wrong id is NOT overwritten.
    expect(store[2][0]).toBe('U-WRONG');
  });

  it('rejects when this LINE user is already linked to a different employee', async () => {
    const r = await repo.linkEmployee('S2A099', 'U-001');
    expect(r.status).toBe('line_already_linked');
    if (r.status === 'line_already_linked') expect(r.employeeId).toBe('S2A001');
  });

  it('is idempotent when the same user re-links the same employee', async () => {
    const r = await repo.linkEmployee('S2A001', 'U-001');
    expect(r.status).toBe('already_linked');
  });

  it('unlink clears ONLY the lineUserId cell and keeps the row', async () => {
    const r = await repo.unlinkEmployee('S2A007');
    expect(r.status).toBe('unlinked');
    if (r.status === 'unlinked') expect(r.previousLineUserId).toBe('U-WRONG');
    // lineUserId cleared, everything else intact.
    expect(store[2][0]).toBe('');
    expect(store[2][1]).toBe('S2A007');
    expect(store[2][2]).toBe('อาร์ม');
    // Row still present.
    expect(store).toHaveLength(4);
    // After unlink, S2A007 can be linked to the correct account.
    const relink = await repo.linkEmployee('S2A007', 'U-correct');
    expect(relink.status).toBe('linked');
  });

  it('unlink reports not_linked when there is nothing to clear', async () => {
    const r = await repo.unlinkEmployee('S2A099');
    expect(r.status).toBe('not_linked');
  });

  it('unlink reports employee_not_found for an unknown id', async () => {
    const r = await repo.unlinkEmployee('ZZZ');
    expect(r.status).toBe('employee_not_found');
  });
});
