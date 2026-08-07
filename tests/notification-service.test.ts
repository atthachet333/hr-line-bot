import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyEvidenceMetadata } from '@/lib/evidence/types';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import type { LineApiResult } from '@/lib/line/types';

const pushToEmployee = vi.fn<() => Promise<LineApiResult>>();
const pushTextToEmployee = vi.fn<() => Promise<LineApiResult>>();
const setEmployeeNotification = vi.fn(async () => {});

vi.mock('@/lib/line/employee-client', () => ({
  pushToEmployee: (...a: unknown[]) => pushToEmployee(...(a as [])),
  pushTextToEmployee: (...a: unknown[]) => pushTextToEmployee(...(a as [])),
}));
vi.mock('@/lib/line/manager-client', () => ({ notifyManagers: vi.fn() }));
vi.mock('@/lib/repositories/leave-request-repository', () => ({
  setEmployeeNotification: (...a: unknown[]) => setEmployeeNotification(...(a as [])),
  setManagerNotification: vi.fn(async () => {}),
}));

import { sendEmployeeNotification } from '@/lib/services/notification-service';

function approved(): LeaveRequest {
  return {
    requestId: 'REQ-20260803-A1B2C3D4',
    clientRequestId: 'c1',
    employeeLineUserId: 'U-emp',
    employeeId: 'EMP001',
    employeeName: 'สมชาย',
    position: 'Dev',
    department: 'IT',
    leaveType: 'ลาป่วย',
    startDate: '2026-08-10',
    endDate: '2026-08-11',
    totalDays: 2,
    reason: 'ไม่สบาย',
    managerLineUserId: 'U-mgr',
    status: 'APPROVED',
    approvedBy: 'คุณวิชัย',
    approvedByLineUserId: 'U-mgr',
    approvedAt: '2026-08-03T03:30:00.000Z',
    rejectedBy: '',
    rejectedByLineUserId: '',
    rejectedAt: '',
    rejectedReason: '',
    approvalSource: 'LINE_MANAGER_BOT',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-03T03:30:00.000Z',
    managerNotificationStatus: 'SENT',
    managerNotificationAttempts: 1,
    managerNotificationLastAttemptAt: '',
    managerNotificationError: '',
    employeeNotificationStatus: 'NOT_STARTED',
    employeeNotificationAttempts: 0,
    employeeNotificationLastAttemptAt: '',
    employeeNotificationError: '',
    ...emptyEvidenceMetadata(),
  };
}

beforeEach(() => {
  pushToEmployee.mockReset();
  pushTextToEmployee.mockReset();
  setEmployeeNotification.mockClear();
});

describe('sendEmployeeNotification', () => {
  it('sends the Flex message and records SENT on success', async () => {
    pushToEmployee.mockResolvedValue({ ok: true, status: 200 });
    const r = await sendEmployeeNotification(approved(), 'cid');
    expect(r.ok).toBe(true);
    expect(pushToEmployee).toHaveBeenCalledTimes(1);
    expect(pushTextToEmployee).not.toHaveBeenCalled();
    expect(setEmployeeNotification).toHaveBeenLastCalledWith('REQ-20260803-A1B2C3D4', {
      status: 'SENT',
      error: '',
    });
  });

  it('falls back to a text message when the Flex delivery fails', async () => {
    pushToEmployee.mockResolvedValue({ ok: false, status: 400, error: 'bad flex' });
    pushTextToEmployee.mockResolvedValue({ ok: true, status: 200 });
    const r = await sendEmployeeNotification(approved(), 'cid');
    expect(r.ok).toBe(true);
    expect(pushToEmployee).toHaveBeenCalledTimes(1);
    expect(pushTextToEmployee).toHaveBeenCalledTimes(1);
    expect(setEmployeeNotification).toHaveBeenLastCalledWith('REQ-20260803-A1B2C3D4', {
      status: 'SENT',
      error: '',
    });
  });

  it('records FAILED (without changing approval status) when both attempts fail', async () => {
    pushToEmployee.mockResolvedValue({ ok: false, status: 500, error: 'flex down' });
    pushTextToEmployee.mockResolvedValue({ ok: false, status: 500, error: 'text down' });
    const req = approved();
    const r = await sendEmployeeNotification(req, 'cid');
    expect(r.ok).toBe(false);
    // The approval record itself is never mutated by the notifier.
    expect(req.status).toBe('APPROVED');
    expect(setEmployeeNotification).toHaveBeenLastCalledWith('REQ-20260803-A1B2C3D4', {
      status: 'FAILED',
      error: 'text down',
    });
  });
});
