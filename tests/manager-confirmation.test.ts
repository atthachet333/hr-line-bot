import { describe, it, expect } from 'vitest';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import {
  buildApproveGroupConfirmation,
  buildRejectGroupConfirmation,
  buildAlreadyProcessedText,
  buildTransitionFailedText,
} from '@/lib/line/manager-confirmation';

function sample(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    requestId: 'REQ-20260806-AAAA1111',
    clientRequestId: 'c1',
    employeeLineUserId: 'U-emp',
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
    status: 'APPROVED',
    approvedBy: 'คุณวิชัย',
    approvedByLineUserId: 'U-mgr',
    approvedAt: '2026-08-06T06:59:00.000Z',
    rejectedBy: '',
    rejectedByLineUserId: '',
    rejectedAt: '',
    rejectedReason: '',
    approvalSource: 'LINE_MANAGER_BOT',
    createdAt: '2026-08-06T06:50:00.000Z',
    updatedAt: '2026-08-06T06:59:00.000Z',
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

describe('manager group confirmations', () => {
  it('approve confirmation includes id, employee(+id), and approver', () => {
    const text = buildApproveGroupConfirmation(sample(), 'คุณวิชัย', '2026-08-06T06:59:00.000Z');
    expect(text).toContain('✅ อนุมัติการลาสำเร็จ');
    expect(text).toContain('REQ-20260806-AAAA1111');
    expect(text).toContain('สมชาย (EMP001)');
    expect(text).toContain('อนุมัติโดย: คุณวิชัย');
    expect(text).toContain('จำนวน: 2 วัน');
  });

  it('reject confirmation includes the reason', () => {
    const text = buildRejectGroupConfirmation(sample({ status: 'REJECTED' }), 'คุณวิชัย', 'มีงานสำคัญในช่วงดังกล่าว', '2026-08-06T07:00:00.000Z');
    expect(text).toContain('❌ ไม่อนุมัติคำขอลาสำเร็จ');
    expect(text).toContain('เหตุผล: มีงานสำคัญในช่วงดังกล่าว');
    expect(text).toContain('ดำเนินการโดย: คุณวิชัย');
  });

  it('already-processed shows the current status in Thai', () => {
    expect(buildAlreadyProcessedText('APPROVED')).toContain('สถานะปัจจุบัน: อนุมัติแล้ว');
    expect(buildAlreadyProcessedText('REJECTED')).toContain('สถานะปัจจุบัน: ไม่อนุมัติ');
  });

  it('transition-failed never claims success', () => {
    const t = buildTransitionFailedText('APPROVED');
    expect(t).toContain('❌');
    expect(t).not.toContain('สำเร็จ');
  });
});
