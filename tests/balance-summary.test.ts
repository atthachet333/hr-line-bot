import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import type { Entitlements } from '@/lib/repositories/balance-repository';

const findEntitlementsMock = vi.fn<() => Promise<Entitlements | null>>();
vi.mock('@/lib/repositories/balance-repository', () => ({
  findEntitlements: () => findEntitlementsMock(),
}));

const listForEmployeeMock = vi.fn<() => Promise<LeaveRequest[]>>();
vi.mock('@/lib/repositories/leave-request-repository', () => ({
  listForEmployee: (...a: unknown[]) => listForEmployeeMock(...(a as [])),
}));

import { computeBalanceSummary, categoryOfLeaveType } from '@/lib/services/balance-summary-service';
import { BusinessRuleError } from '@/lib/errors';

function leave(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    requestId: 'REQ-1',
    clientRequestId: 'c',
    employeeLineUserId: 'U-A',
    employeeId: 'S2A001',
    employeeName: 'สมชาย',
    position: 'dev',
    department: 'IT',
    leaveType: 'ลาพักร้อน',
    startDate: '2026-08-01',
    endDate: '2026-08-04',
    totalDays: 4,
    reason: 'พักผ่อน',
    managerLineUserId: 'U-mgr',
    status: 'APPROVED',
    approvedBy: '',
    approvedByLineUserId: '',
    approvedAt: '',
    rejectedBy: '',
    rejectedByLineUserId: '',
    rejectedAt: '',
    rejectedReason: '',
    approvalSource: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    managerNotificationStatus: 'SENT',
    managerNotificationAttempts: 1,
    managerNotificationLastAttemptAt: '',
    managerNotificationError: '',
    employeeNotificationStatus: 'NOT_STARTED',
    employeeNotificationAttempts: 0,
    employeeNotificationLastAttemptAt: '',
    employeeNotificationError: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findEntitlementsMock.mockResolvedValue({ sick: 30, business: 6, annual: 6 });
});

describe('categoryOfLeaveType', () => {
  it('maps Thai labels to categories', () => {
    expect(categoryOfLeaveType('ลาป่วย')).toBe('sick');
    expect(categoryOfLeaveType('ลากิจ')).toBe('business');
    expect(categoryOfLeaveType('ลาพักร้อน')).toBe('annual');
    expect(categoryOfLeaveType('ลาอื่นๆ (ลาบวช)')).toBeNull();
  });
});

describe('computeBalanceSummary', () => {
  it('deducts an APPROVED annual leave: used=4 remaining=2', async () => {
    listForEmployeeMock.mockResolvedValue([leave({ leaveType: 'ลาพักร้อน', totalDays: 4, status: 'APPROVED' })]);
    const s = await computeBalanceSummary('U-A', 'S2A001');
    expect(s.annual).toEqual({ entitlement: 6, used: 4, remaining: 2 });
    expect(s.sick).toEqual({ entitlement: 30, used: 0, remaining: 30 });
    expect(s.business).toEqual({ entitlement: 6, used: 0, remaining: 6 });
  });

  it('does NOT deduct PENDING or REJECTED requests', async () => {
    listForEmployeeMock.mockResolvedValue([
      leave({ leaveType: 'ลาพักร้อน', totalDays: 3, status: 'PENDING' }),
      leave({ leaveType: 'ลาพักร้อน', totalDays: 2, status: 'REJECTED' }),
    ]);
    const s = await computeBalanceSummary('U-A', 'S2A001');
    expect(s.annual.used).toBe(0);
    expect(s.annual.remaining).toBe(6);
  });

  it('sums multiple APPROVED requests per category (incl. half days)', async () => {
    listForEmployeeMock.mockResolvedValue([
      leave({ leaveType: 'ลาป่วย', totalDays: 1, status: 'APPROVED' }),
      leave({ leaveType: 'ลาป่วย', totalDays: 0.5, status: 'APPROVED' }),
      leave({ leaveType: 'ลากิจ', totalDays: 2, status: 'APPROVED' }),
    ]);
    const s = await computeBalanceSummary('U-A', 'S2A001');
    expect(s.sick.used).toBe(1.5);
    expect(s.sick.remaining).toBe(28.5);
    expect(s.business.used).toBe(2);
  });

  it('clamps remaining at 0 when usage exceeds entitlement', async () => {
    listForEmployeeMock.mockResolvedValue([leave({ leaveType: 'ลากิจ', totalDays: 9, status: 'APPROVED' })]);
    const s = await computeBalanceSummary('U-A', 'S2A001');
    expect(s.business.used).toBe(9);
    expect(s.business.remaining).toBe(0);
  });

  it('queries only the verified employee (passes lineUserId + employeeId)', async () => {
    listForEmployeeMock.mockResolvedValue([]);
    await computeBalanceSummary('U-A', 'S2A001');
    expect(listForEmployeeMock).toHaveBeenCalledWith('U-A', 'S2A001');
  });

  it('throws BALANCE_NOT_CONFIGURED when there is no Balances row', async () => {
    findEntitlementsMock.mockResolvedValue(null);
    await expect(computeBalanceSummary('U-A', 'S2A001')).rejects.toMatchObject({
      code: 'BALANCE_NOT_CONFIGURED',
    });
    expect(await computeBalanceSummary('U-A', 'S2A001').catch((e) => e)).toBeInstanceOf(BusinessRuleError);
  });
});
