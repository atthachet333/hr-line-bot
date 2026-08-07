import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyEvidenceMetadata } from '@/lib/evidence/types';
import { LEAVE_REQUEST_COLUMNS, type LeaveRequest } from '@/lib/domain/leave-request';

/**
 * In-memory fake of the subset of the Google Sheets client used by the
 * repository. `store` holds rows including the header row at index 0.
 */
const store: string[][] = [];

function rangeGet(range: string) {
  if (range.endsWith('!1:1')) {
    return { data: { values: store.length ? [store[0]] : [] } };
  }
  if (range.includes('A2:')) {
    return { data: { values: store.slice(1) } };
  }
  return { data: { values: store } };
}

const fakeSheets = {
  spreadsheets: {
    values: {
      get: vi.fn(async ({ range }: { range: string }) => rangeGet(range)),
      update: vi.fn(async ({ range, requestBody }: { range: string; requestBody: { values: string[][] } }) => {
        const m = range.match(/!A(\d+)/);
        if (m) {
          const row = Number(m[1]) - 1;
          store[row] = requestBody.values[0];
        }
        return {};
      }),
      append: vi.fn(async ({ requestBody }: { requestBody: { values: string[][] } }) => {
        store.push(requestBody.values[0]);
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

import * as repo from '@/lib/repositories/leave-request-repository';

function sampleRequest(requestId: string): LeaveRequest {
  return {
    requestId,
    clientRequestId: 'client-1',
    employeeLineUserId: 'U-emp',
    employeeId: 'EMP001',
    employeeName: 'สมชาย',
    position: 'Dev',
    department: 'IT',
    leaveType: 'ลาป่วย',
    startDate: '2026-07-25',
    endDate: '2026-07-26',
    totalDays: 2,
    reason: 'ไม่สบาย',
    managerLineUserId: 'U-mgr',
    status: 'PENDING',
    approvedBy: '',
    approvedByLineUserId: '',
    approvedAt: '',
    rejectedBy: '',
    rejectedByLineUserId: '',
    rejectedAt: '',
    rejectedReason: '',
    approvalSource: '',
    createdAt: '2026-07-25T02:00:00.000Z',
    updatedAt: '2026-07-25T02:00:00.000Z',
    managerNotificationStatus: 'SENT',
    managerNotificationAttempts: 1,
    managerNotificationLastAttemptAt: '2026-07-25T02:00:00.000Z',
    managerNotificationError: '',
    employeeNotificationStatus: 'NOT_STARTED',
    employeeNotificationAttempts: 0,
    employeeNotificationLastAttemptAt: '',
    employeeNotificationError: '',
    ...emptyEvidenceMetadata(),
  };
}

/** Serialise a request into a sheet row aligned to the canonical header order. */
function toStringRow(req: LeaveRequest): string[] {
  return (LEAVE_REQUEST_COLUMNS as string[]).map((col) => {
    const v = (req as unknown as Record<string, unknown>)[col];
    return v === undefined || v === null ? '' : String(v);
  });
}

describe('leave request repository', () => {
  beforeEach(() => {
    store.length = 0;
    store.push([...(LEAVE_REQUEST_COLUMNS as string[])]);
  });

  it('creates and finds a request by id and idempotency key', async () => {
    await repo.create(sampleRequest('REQ-20260725-AAAA1111'));
    const byId = await repo.findByRequestId('REQ-20260725-AAAA1111');
    expect(byId?.request.employeeName).toBe('สมชาย');
    const byKey = await repo.findByIdempotencyKey('U-emp', 'client-1');
    expect(byKey?.request.requestId).toBe('REQ-20260725-AAAA1111');
    // Different user with same clientRequestId must NOT match.
    const wrongUser = await repo.findByIdempotencyKey('U-other', 'client-1');
    expect(wrongUser).toBeNull();
  });

  it('detects overlapping active requests', async () => {
    await repo.create(sampleRequest('REQ-20260725-DDDD4444'));
    const overlap = await repo.findOverlapping('U-emp', 'EMP001', '2026-07-26', '2026-07-28');
    expect(overlap?.requestId).toBe('REQ-20260725-DDDD4444');
    const noOverlap = await repo.findOverlapping('U-emp', 'EMP001', '2026-08-01', '2026-08-02');
    expect(noOverlap).toBeNull();
  });

  describe('findOverlapping — per-employee only (Bug 1 regression)', () => {
    it('A on 10 Aug does NOT block B on 10 Aug (different employees)', async () => {
      await repo.create({
        ...sampleRequest('REQ-20260810-AAAA0001'),
        employeeLineUserId: 'U-A', employeeId: 'S2A001',
        startDate: '2026-08-10', endDate: '2026-08-10', status: 'APPROVED',
      });
      const bOverlap = await repo.findOverlapping('U-B', 'S2A002', '2026-08-10', '2026-08-10');
      expect(bOverlap).toBeNull(); // B is free to take the same day
    });

    it('A cannot double-book their OWN overlapping dates (inclusive)', async () => {
      await repo.create({
        ...sampleRequest('REQ-20260810-AAAA0010'),
        employeeLineUserId: 'U-A', employeeId: 'S2A001',
        startDate: '2026-08-10', endDate: '2026-08-11', status: 'PENDING',
      });
      // 11 Aug intersects 10–11 Aug (inclusive end).
      const dup = await repo.findOverlapping('U-A', 'S2A001', '2026-08-11', '2026-08-12');
      expect(dup?.requestId).toBe('REQ-20260810-AAAA0010');
    });

    it('REJECTED / CANCELLED do NOT block a new request', async () => {
      await repo.create({
        ...sampleRequest('REQ-20260810-AAAA0020'),
        employeeLineUserId: 'U-A', employeeId: 'S2A001',
        startDate: '2026-08-10', endDate: '2026-08-10', status: 'REJECTED',
      });
      await repo.create({
        ...sampleRequest('REQ-20260810-AAAA0021'),
        employeeLineUserId: 'U-A', employeeId: 'S2A001',
        startDate: '2026-08-12', endDate: '2026-08-12', status: 'CANCELLED',
      });
      expect(await repo.findOverlapping('U-A', 'S2A001', '2026-08-10', '2026-08-10')).toBeNull();
      expect(await repo.findOverlapping('U-A', 'S2A001', '2026-08-12', '2026-08-12')).toBeNull();
    });

    it('matches the SAME employee by canonical employeeId even if lineUserId is blank', async () => {
      await repo.create({
        ...sampleRequest('REQ-20260810-LEGACY01'),
        employeeLineUserId: '', employeeId: 's2a001', // legacy row, lowercase id, no line id
        startDate: '2026-08-10', endDate: '2026-08-10', status: 'PENDING',
      });
      // Same employee (canonical S2A001) is blocked...
      expect((await repo.findOverlapping('U-A', 'S2A001', '2026-08-10', '2026-08-10'))?.requestId).toBe(
        'REQ-20260810-LEGACY01',
      );
      // ...but a different employee with a blank line id is NOT (no ''==='' collision).
      expect(await repo.findOverlapping('', 'S2A999', '2026-08-10', '2026-08-10')).toBeNull();
    });
  });

  it('approves a PENDING request (test case: approve pending)', async () => {
    await repo.create(sampleRequest('REQ-20260725-BBBB2222'));
    const result = await repo.transitionFromPending('REQ-20260725-BBBB2222', {
      status: 'APPROVED',
      approvedBy: 'หัวหน้า',
      approvedAt: '2026-07-25T03:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.status).toBe('APPROVED');
  });

  it('prevents double approval (test case: duplicate approve)', async () => {
    await repo.create(sampleRequest('REQ-20260725-CCCC3333'));
    const first = await repo.transitionFromPending('REQ-20260725-CCCC3333', {
      status: 'APPROVED',
      approvedBy: 'หัวหน้า',
      approvedAt: '2026-07-25T03:00:00.000Z',
    });
    expect(first.ok).toBe(true);

    const second = await repo.transitionFromPending('REQ-20260725-CCCC3333', {
      status: 'REJECTED',
      rejectedBy: 'หัวหน้าคนที่สอง',
      rejectedAt: '2026-07-25T03:05:00.000Z',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('already_processed');
      expect(second.current?.status).toBe('APPROVED');
    }
  });

  it('returns not_found for unknown request ids', async () => {
    const r = await repo.transitionFromPending('REQ-20260725-ZZZZ9999', {
      status: 'APPROVED',
      approvedBy: 'x',
      approvedAt: 'y',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });

  describe('listForEmployee', () => {
    it('returns only the employee’s own requests, newest first', async () => {
      const a1 = { ...sampleRequest('REQ-20260801-AAAA0001'), employeeLineUserId: 'U-A', createdAt: '2026-08-01T00:00:00.000Z' };
      const a2 = { ...sampleRequest('REQ-20260803-AAAA0002'), employeeLineUserId: 'U-A', createdAt: '2026-08-03T00:00:00.000Z' };
      const b1 = { ...sampleRequest('REQ-20260802-BBBB0001'), employeeLineUserId: 'U-B', employeeId: 'EMP999', createdAt: '2026-08-02T00:00:00.000Z' };
      await repo.create(a1);
      await repo.create(b1);
      await repo.create(a2);

      const list = await repo.listForEmployee('U-A', 'EMP001');
      expect(list.map((r) => r.requestId)).toEqual(['REQ-20260803-AAAA0002', 'REQ-20260801-AAAA0001']);
      // Employee A never sees B's request.
      expect(list.some((r) => r.employeeLineUserId === 'U-B')).toBe(false);
    });

    it('matches legacy rows by employeeId only when the row has no LINE id', async () => {
      const legacy = { ...sampleRequest('REQ-20260701-LEGA0001'), employeeLineUserId: '', employeeId: 'EMP001' };
      const otherLegacy = { ...sampleRequest('REQ-20260701-LEGA0002'), employeeLineUserId: '', employeeId: 'EMP002' };
      await repo.create(legacy);
      await repo.create(otherLegacy);

      const list = await repo.listForEmployee('U-A', 'EMP001');
      expect(list.map((r) => r.requestId)).toEqual(['REQ-20260701-LEGA0001']);
    });

    it('returns [] when the employee has no requests', async () => {
      await repo.create({ ...sampleRequest('REQ-20260801-OTHER001'), employeeLineUserId: 'U-someone-else' });
      const list = await repo.listForEmployee('U-nobody', 'EMP-nobody');
      expect(list).toEqual([]);
    });

    it('normalises a startDate that Sheets stored as a serial number', async () => {
      // Simulate a legacy row where "2021-01-01" was coerced to serial 44197.
      const startIdx = (LEAVE_REQUEST_COLUMNS as string[]).indexOf('startDate');
      const row = toStringRow({ ...sampleRequest('REQ-20210101-SERIAL01'), employeeLineUserId: 'U-serial' });
      row[startIdx] = '44197';
      store.push(row);

      const list = await repo.listForEmployee('U-serial', 'EMP001');
      expect(list[0].startDate).toBe('2021-01-01');
      // A proper YMD endDate is preserved.
      expect(list[0].endDate).toBe('2026-07-26');
    });
  });
});
