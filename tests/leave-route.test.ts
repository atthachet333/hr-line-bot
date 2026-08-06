import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvelopeResult } from '@/lib/google-apps-script/client';
import type { Employee } from '@/lib/repositories/employee-repository';
import type { LeaveRequest } from '@/lib/domain/leave-request';

// ---- mocks for everything external to the route + balance service ----

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({
  verifyIdentity: (...a: unknown[]) => verifyIdentityMock(...a),
}));

const findByLineUserIdMock = vi.fn<() => Promise<Employee | null>>();
vi.mock('@/lib/repositories/employee-repository', () => ({
  findByLineUserId: () => findByLineUserIdMock(),
}));

const findByIdempotencyKeyMock = vi.fn().mockResolvedValue(null);
const findOverlappingMock = vi.fn().mockResolvedValue(null);
const createMock = vi.fn<(r: LeaveRequest) => Promise<void>>().mockResolvedValue(undefined);
vi.mock('@/lib/repositories/leave-request-repository', () => ({
  findByIdempotencyKey: (...a: unknown[]) => findByIdempotencyKeyMock(...a),
  findOverlapping: (...a: unknown[]) => findOverlappingMock(...a),
  create: (r: LeaveRequest) => createMock(r),
}));

const auditAppendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/repositories/audit-log-repository', () => ({
  append: (...a: unknown[]) => auditAppendMock(...a),
}));

vi.mock('@/lib/repositories/holiday-repository', () => ({
  loadHolidays: () => Promise.resolve(new Set<string>()),
}));

const sendManagerNotificationMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/services/notification-service', () => ({
  sendManagerNotification: (...a: unknown[]) => sendManagerNotificationMock(...a),
}));

// The balance service is exercised for real; only its Apps Script transport is mocked.
const callEnvelopeMock = vi.fn<() => Promise<EnvelopeResult>>();
vi.mock('@/lib/google-apps-script/client', () => ({
  callAppsScriptEnvelope: (...a: unknown[]) => callEnvelopeMock(...(a as [])),
}));

import { POST } from '@/app/api/leave/route';

const EMPLOYEE: Employee = {
  lineUserId: 'Uemp',
  employeeId: 'EMP001',
  name: 'น้องถ้วยฟู',
  position: 'Dev',
  department: 'IT',
  managerLineUserId: 'Umgr',
};

let userSeq = 0;
function makeReq(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://localhost:3333/api/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accessToken: 'tok',
      clientRequestId: `cid-${userSeq}`,
      leaveType: 'ลาป่วย',
      startDate: '2026-08-10', // Monday
      endDate: '2026-08-11', // Tuesday
      reason: 'ปวดหัว',
      ...overrides,
    }),
  });
}

function balanceOk(data: Record<string, unknown>): EnvelopeResult {
  return { ok: true, envelope: { success: true, code: 'OK', data } };
}

beforeEach(() => {
  vi.clearAllMocks();
  findByIdempotencyKeyMock.mockResolvedValue(null);
  findOverlappingMock.mockResolvedValue(null);
  createMock.mockResolvedValue(undefined);
  auditAppendMock.mockResolvedValue(undefined);
  sendManagerNotificationMock.mockResolvedValue({ ok: true });
  // Unique verified user per test so the per-user rate limit never trips.
  userSeq += 1;
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: `Uemp-${userSeq}` } });
  findByLineUserIdMock.mockResolvedValue(EMPLOYEE);
});

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('POST /api/leave', () => {
  it('creates the request when getBalance succeeds with enough balance', async () => {
    callEnvelopeMock.mockResolvedValue(balanceOk({ sickTotal: 30, sickUsed: 0 }));
    const res = await POST(makeReq());
    const body = await bodyOf(res);

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.code).toBe('LEAVE_REQUEST_CREATED');
    expect((body.data as Record<string, unknown>).balanceChecked).toBe(true);
    // Persisted as PENDING.
    const record = createMock.mock.calls[0][0];
    expect(record.status).toBe('PENDING');
    expect(record.employeeId).toBe('EMP001');
    expect(record.totalDays).toBe(2);
    // Manager was notified, no skip audit entry.
    expect(sendManagerNotificationMock).toHaveBeenCalledTimes(1);
    const actions = auditAppendMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toContain('CREATE');
    expect(actions).not.toContain('LEAVE_BALANCE_CHECK_SKIPPED');
  });

  it('creates the request (with warning) when getBalance times out / aborts', async () => {
    callEnvelopeMock.mockResolvedValue({
      ok: false,
      kind: 'transport',
      status: 0,
      error: 'Apps Script request failed: This operation was aborted',
    });
    const res = await POST(makeReq());
    const body = await bodyOf(res);

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect((body.data as Record<string, unknown>).balanceChecked).toBe(false);
    expect(createMock.mock.calls[0][0].status).toBe('PENDING');
    const actions = auditAppendMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toContain('LEAVE_BALANCE_CHECK_SKIPPED');
    expect(sendManagerNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('creates the request when getBalance returns EMPLOYEE_NOT_FOUND (legacy)', async () => {
    callEnvelopeMock.mockResolvedValue({ ok: true, envelope: { success: false, code: 'EMPLOYEE_NOT_FOUND' } });
    const res = await POST(makeReq());
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).success).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('creates the request when getBalance returns NOT_IMPLEMENTED', async () => {
    callEnvelopeMock.mockResolvedValue({ ok: true, envelope: { success: false, code: 'NOT_IMPLEMENTED' } });
    const res = await POST(makeReq());
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).success).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with EMPLOYEE_NOT_LINKED when the employee is not linked in the Employees sheet', async () => {
    findByLineUserIdMock.mockResolvedValue(null);
    const res = await POST(makeReq());
    const body = await bodyOf(res);
    expect(res.status).toBe(403);
    expect(body.code).toBe('EMPLOYEE_NOT_LINKED');
    expect(createMock).not.toHaveBeenCalled();
    // getBalance must never be used to establish identity.
    expect(callEnvelopeMock).not.toHaveBeenCalled();
  });

  it('uses employee fields from the sheet, never from the request body', async () => {
    callEnvelopeMock.mockResolvedValue(balanceOk({ sickTotal: 30, sickUsed: 0 }));
    // Attacker-supplied identity fields in the body must be ignored.
    const res = await POST(
      makeReq({ employeeId: 'HACKER', employeeName: 'ผู้บุกรุก', position: 'CEO', department: 'X' }),
    );
    expect(res.status).toBe(201);
    const record = createMock.mock.calls[0][0];
    expect(record.employeeId).toBe('EMP001'); // from the mocked sheet employee
    expect(record.employeeName).toBe('น้องถ้วยฟู');
    expect(record.position).toBe('Dev');
    expect(record.department).toBe('IT');
  });

  it('rejects with INSUFFICIENT_LEAVE_BALANCE when a real balance is too low', async () => {
    callEnvelopeMock.mockResolvedValue(balanceOk({ sickTotal: 1, sickUsed: 1 }));
    const res = await POST(makeReq()); // 2 days requested, 0 remaining
    const body = await bodyOf(res);
    expect(res.status).toBe(400);
    expect(body.code).toBe('INSUFFICIENT_LEAVE_BALANCE');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request without touching balance', async () => {
    verifyIdentityMock.mockResolvedValue({ ok: false });
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
    expect(callEnvelopeMock).not.toHaveBeenCalled();
  });

  it('returns 202 (still created) when the manager notification fails', async () => {
    callEnvelopeMock.mockResolvedValue(balanceOk({ sickTotal: 30, sickUsed: 0 }));
    sendManagerNotificationMock.mockResolvedValue({ ok: false, error: 'boom' });
    const res = await POST(makeReq());
    const body = await bodyOf(res);
    expect(res.status).toBe(202);
    expect(body.success).toBe(true);
    expect(body.code).toBe('LEAVE_REQUEST_CREATED_NOTIFY_FAILED');
    expect(createMock).toHaveBeenCalledTimes(1); // request still persisted
    const actions = auditAppendMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toContain('NOTIFY_MANAGER_FAILED');
  });

  it('is idempotent: a duplicate clientRequestId returns the existing request', async () => {
    findByIdempotencyKeyMock.mockResolvedValue({
      request: { requestId: 'REQ-existing', status: 'PENDING', managerNotificationStatus: 'SENT' },
    });
    const res = await POST(makeReq());
    const body = await bodyOf(res);
    expect(res.status).toBe(200);
    expect(body.code).toBe('DUPLICATE_REQUEST');
    expect((body.data as Record<string, unknown>).requestId).toBe('REQ-existing');
    expect(createMock).not.toHaveBeenCalled();
  });
});
