import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    approvedAt: '',
    rejectedBy: '',
    rejectedAt: '',
    rejectedReason: '',
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
  };
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
    const overlap = await repo.findOverlapping('U-emp', '2026-07-26', '2026-07-28');
    expect(overlap?.requestId).toBe('REQ-20260725-DDDD4444');
    const noOverlap = await repo.findOverlapping('U-emp', '2026-08-01', '2026-08-02');
    expect(noOverlap).toBeNull();
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
});
