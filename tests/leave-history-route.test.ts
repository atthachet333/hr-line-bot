import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyEvidenceMetadata } from '@/lib/evidence/types';
import type { Employee } from '@/lib/repositories/employee-repository';
import type { LeaveRequest } from '@/lib/domain/leave-request';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({
  verifyIdentity: (...a: unknown[]) => verifyIdentityMock(...a),
}));

const findByLineUserIdMock = vi.fn<() => Promise<Employee | null>>();
vi.mock('@/lib/repositories/employee-repository', () => ({
  findByLineUserId: () => findByLineUserIdMock(),
}));

const listForEmployeeMock = vi.fn<() => Promise<LeaveRequest[]>>();
vi.mock('@/lib/repositories/leave-request-repository', () => ({
  listForEmployee: (...a: unknown[]) => listForEmployeeMock(...(a as [])),
}));

import { GET } from '@/app/api/leave/history/route';

const EMPLOYEE: Employee = {
  lineUserId: 'U-A',
  employeeId: 'EMP001',
  name: 'สมชาย',
  position: 'Dev',
  department: 'IT',
  managerLineUserId: 'U-mgr',
};

function base(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    requestId: 'REQ-1',
    clientRequestId: 'c1',
    employeeLineUserId: 'U-A',
    employeeId: 'EMP001',
    employeeName: 'สมชาย',
    position: 'Dev',
    department: 'IT',
    leaveType: 'ลาป่วย',
    startDate: '2026-08-06',
    endDate: '2026-08-07',
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
    createdAt: '2026-08-06T06:50:00.000Z',
    updatedAt: '2026-08-06T06:50:00.000Z',
    managerNotificationStatus: 'SENT',
    managerNotificationAttempts: 1,
    managerNotificationLastAttemptAt: '',
    managerNotificationError: '',
    employeeNotificationStatus: 'NOT_STARTED',
    employeeNotificationAttempts: 0,
    employeeNotificationLastAttemptAt: '',
    employeeNotificationError: '',
    ...emptyEvidenceMetadata(),
    ...overrides,
  };
}

function req(token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('http://localhost:3333/api/leave/history', { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: 'U-A' } });
  findByLineUserIdMock.mockResolvedValue(EMPLOYEE);
  listForEmployeeMock.mockResolvedValue([]);
});

describe('GET /api/leave/history', () => {
  it('returns the verified employee’s items with no-store and resolves identity from the token only', async () => {
    listForEmployeeMock.mockResolvedValue([
      base({ requestId: 'REQ-APPROVED', status: 'APPROVED', approvedBy: 'คุณวิชัย', approvedAt: '2026-08-06T07:00:00.000Z' }),
      base({ requestId: 'REQ-PENDING', status: 'PENDING' }),
    ]);
    const res = await GET(req('tok-A'));
    const body = (await res.json()) as { success: boolean; items: Array<Record<string, unknown>> };

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.success).toBe(true);
    expect(body.items).toHaveLength(2);
    // Identity → sheet lookup drives the query (verified lineUserId + employeeId).
    expect(listForEmployeeMock).toHaveBeenCalledWith('U-A', 'EMP001');
    // Approved item carries approver fields; no LINE ids are leaked.
    const approved = body.items.find((i) => i.requestId === 'REQ-APPROVED')!;
    expect(approved.approvedBy).toBe('คุณวิชัย');
    expect(approved.status).toBe('APPROVED');
    expect(approved).not.toHaveProperty('employeeLineUserId');
    expect(approved).not.toHaveProperty('approvedByLineUserId');
  });

  it('surfaces rejected reason', async () => {
    listForEmployeeMock.mockResolvedValue([
      base({ requestId: 'REQ-REJ', status: 'REJECTED', rejectedBy: 'คุณวิชัย', rejectedReason: 'งานเร่งด่วน' }),
    ]);
    const res = await GET(req('tok-A'));
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items[0].rejectedReason).toBe('งานเร่งด่วน');
  });

  it('returns items:[] (not an error) when there is no history', async () => {
    listForEmployeeMock.mockResolvedValue([]);
    const res = await GET(req('tok-A'));
    const body = (await res.json()) as { success: boolean; items: unknown[] };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.items).toEqual([]);
  });

  it('returns 401 when no token is supplied', async () => {
    const res = await GET(req(null));
    const body = (await res.json()) as { code: string };
    expect(res.status).toBe(401);
    expect(body.code).toBe('AUTHENTICATION_ERROR');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(verifyIdentityMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the token fails verification', async () => {
    verifyIdentityMock.mockResolvedValue({ ok: false, error: 'bad token' });
    const res = await GET(req('bad'));
    expect(res.status).toBe(401);
    expect(listForEmployeeMock).not.toHaveBeenCalled();
  });

  it('returns EMPLOYEE_NOT_LINKED when the user is not in the Employees sheet', async () => {
    findByLineUserIdMock.mockResolvedValue(null);
    const res = await GET(req('tok-A'));
    const body = (await res.json()) as { code: string };
    expect(res.status).toBe(403);
    expect(body.code).toBe('EMPLOYEE_NOT_LINKED');
    expect(listForEmployeeMock).not.toHaveBeenCalled();
  });
});
