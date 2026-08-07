import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyEvidenceMetadata } from '@/lib/evidence/types';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import type { EntitlementLookup } from '@/lib/repositories/balance-repository';

const findEntitlementsMock = vi.fn<() => Promise<EntitlementLookup>>();
vi.mock('@/lib/repositories/balance-repository', () => ({
  findEntitlements: () => findEntitlementsMock(),
}));

const listForEmployeeMock = vi.fn<() => Promise<LeaveRequest[]>>();
vi.mock('@/lib/repositories/leave-request-repository', () => ({
  listForEmployee: (...a: unknown[]) => listForEmployeeMock(...(a as [])),
}));

import { computeBalanceSummary, categoryOfLeaveType } from '@/lib/services/balance-summary-service';

const ALL_FIELDS = { sick: true, business: true, annual: true };
function okLookup(sick: number, business: number, annual: number): EntitlementLookup {
  return { status: 'ok', entitlements: { sick, business, annual }, fields: ALL_FIELDS };
}

function leave(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    requestId: 'REQ-1', clientRequestId: 'c', employeeLineUserId: 'U-A', employeeId: 'S2A001',
    employeeName: 'สมชาย', position: 'dev', department: 'IT', leaveType: 'ลาพักร้อน',
    startDate: '2026-08-01', endDate: '2026-08-04', totalDays: 4, reason: 'x',
    managerLineUserId: 'U-mgr', status: 'APPROVED', approvedBy: '', approvedByLineUserId: '',
    approvedAt: '', rejectedBy: '', rejectedByLineUserId: '', rejectedAt: '', rejectedReason: '',
    approvalSource: '', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    managerNotificationStatus: 'SENT', managerNotificationAttempts: 1, managerNotificationLastAttemptAt: '',
    managerNotificationError: '', employeeNotificationStatus: 'NOT_STARTED', employeeNotificationAttempts: 0,
    employeeNotificationLastAttemptAt: '', employeeNotificationError: '',
 ...emptyEvidenceMetadata(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findEntitlementsMock.mockResolvedValue(okLookup(30, 6, 6));
  listForEmployeeMock.mockResolvedValue([]);
});

describe('categoryOfLeaveType', () => {
  it('maps Thai labels', () => {
    expect(categoryOfLeaveType('ลาป่วย')).toBe('sick');
    expect(categoryOfLeaveType('ลากิจ')).toBe('business');
    expect(categoryOfLeaveType('ลาพักร้อน')).toBe('annual');
    expect(categoryOfLeaveType('ลาอื่นๆ (ลาบวช)')).toBeNull();
  });
});

describe('computeBalanceSummary', () => {
  it('reads 30/6/6 and deducts APPROVED usage (sick 2 → 28, annual 4 → 2)', async () => {
    listForEmployeeMock.mockResolvedValue([
      leave({ leaveType: 'ลาป่วย', totalDays: 2, status: 'APPROVED' }),
      leave({ leaveType: 'ลาพักร้อน', totalDays: 4, status: 'APPROVED' }),
    ]);
    const r = await computeBalanceSummary('U-A', 'S2A001');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.sick).toEqual({ entitlement: 30, used: 2, remaining: 28 });
      expect(r.summary.business).toEqual({ entitlement: 6, used: 0, remaining: 6 });
      expect(r.summary.annual).toEqual({ entitlement: 6, used: 4, remaining: 2 });
      expect(r.meta.approvedLeaveCount).toBe(2);
      expect(r.meta.balanceRowFound).toBe(true);
    }
  });

  it('does NOT deduct PENDING or REJECTED', async () => {
    listForEmployeeMock.mockResolvedValue([
      leave({ leaveType: 'ลาพักร้อน', totalDays: 3, status: 'PENDING' }),
      leave({ leaveType: 'ลาพักร้อน', totalDays: 2, status: 'REJECTED' }),
    ]);
    const r = await computeBalanceSummary('U-A', 'S2A001');
    if (r.ok) expect(r.summary.annual).toEqual({ entitlement: 6, used: 0, remaining: 6 });
  });

  it('clamps remaining at 0 but keeps used when over-entitlement', async () => {
    findEntitlementsMock.mockResolvedValue(okLookup(0, 6, 6)); // sick entitlement 0
    listForEmployeeMock.mockResolvedValue([leave({ leaveType: 'ลาป่วย', totalDays: 2, status: 'APPROVED' })]);
    const r = await computeBalanceSummary('U-A', 'S2A001');
    if (r.ok) {
      expect(r.summary.sick.used).toBe(2);
      expect(r.summary.sick.entitlement).toBe(0);
      expect(r.summary.sick.remaining).toBe(0);
    }
  });

  it('returns BALANCE_NOT_CONFIGURED when there is no row', async () => {
    findEntitlementsMock.mockResolvedValue({ status: 'not_found' });
    const r = await computeBalanceSummary('U-A', 'S2A001');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('BALANCE_NOT_CONFIGURED');
      expect(r.meta.balanceRowFound).toBe(false);
    }
  });

  it('returns BALANCE_DATA_INVALID for a blank/non-numeric entitlement', async () => {
    findEntitlementsMock.mockResolvedValue({ status: 'invalid', reason: 'blank sick', fields: { sick: false, business: true, annual: true } });
    const r = await computeBalanceSummary('U-A', 'S2A001');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BALANCE_DATA_INVALID');
  });

  it('returns BALANCE_DATA_INVALID (integrity) for a duplicate employeeId', async () => {
    findEntitlementsMock.mockResolvedValue({ status: 'duplicate', count: 2 });
    const r = await computeBalanceSummary('U-A', 'S2A001');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BALANCE_DATA_INVALID');
  });

  it('scopes usage to the verified employee only', async () => {
    await computeBalanceSummary('U-A', 'S2A001');
    expect(listForEmployeeMock).toHaveBeenCalledWith('U-A', 'S2A001');
  });
});
