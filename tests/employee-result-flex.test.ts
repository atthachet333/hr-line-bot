import { describe, it, expect } from 'vitest';
import { emptyEvidenceMetadata } from '@/lib/evidence/types';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import {
  buildApprovedLeaveFlexMessage,
  buildRejectedLeaveFlexMessage,
  approvedEmployeeText,
  rejectedEmployeeText,
} from '@/lib/line/employee-result-flex';

function sample(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    requestId: 'REQ-20260803-A1B2C3D4',
    clientRequestId: 'client-1',
    employeeLineUserId: 'U-emp',
    employeeId: 'EMP001',
    employeeName: 'นายสมชาย ใจดี',
    position: 'เจ้าหน้าที่บัญชี',
    department: 'Accounting',
    leaveType: 'ลาป่วย',
    startDate: '2026-08-10',
    endDate: '2026-08-11',
    totalDays: 2,
    reason: 'มีอาการไข้และต้องเข้าพบแพทย์',
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
    createdAt: '2026-08-01T02:00:00.000Z',
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
    ...overrides,
  };
}

/** Collect every string in a nested Flex structure for easy content assertions. */
function collectText(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string') acc.push(node);
  else if (Array.isArray(node)) node.forEach((n) => collectText(n, acc));
  else if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) collectText(v, acc);
  }
  return acc;
}

describe('approved leave Flex message', () => {
  it('includes all core request fields', () => {
    const msg = buildApprovedLeaveFlexMessage(sample());
    const text = collectText(msg.contents).join('\n');
    expect(text).toContain('REQ-20260803-A1B2C3D4');
    expect(text).toContain('นายสมชาย ใจดี');
    expect(text).toContain('EMP001');
    expect(text).toContain('เจ้าหน้าที่บัญชี');
    expect(text).toContain('Accounting');
    expect(text).toContain('ลาป่วย');
    expect(text).toContain('2 วัน');
  });

  it('shows the approver display name', () => {
    const text = collectText(buildApprovedLeaveFlexMessage(sample()).contents).join('\n');
    expect(text).toContain('คุณวิชัย');
  });

  it('renders the start date in Thai (Buddhist year)', () => {
    const text = collectText(buildApprovedLeaveFlexMessage(sample()).contents).join('\n');
    expect(text).toContain('10 สิงหาคม 2569');
    expect(text).toContain('11 สิงหาคม 2569');
  });

  it('has an understandable altText', () => {
    const msg = buildApprovedLeaveFlexMessage(sample());
    expect(msg.altText).toContain('อนุมัติ');
    expect(msg.altText).toContain('REQ-20260803-A1B2C3D4');
  });

  it('supports a multi-line reason', () => {
    const msg = buildApprovedLeaveFlexMessage(sample({ reason: 'บรรทัดแรก\nบรรทัดสอง' }));
    const strings = collectText(msg.contents);
    expect(strings).toContain('บรรทัดแรก');
    expect(strings).toContain('บรรทัดสอง');
  });

  it('falls back to a safe approver label when name is missing', () => {
    const text = collectText(buildApprovedLeaveFlexMessage(sample({ approvedBy: '' })).contents).join('\n');
    expect(text).toContain('ผู้บริหาร');
  });
});

describe('rejected leave Flex message', () => {
  const rejected = () =>
    sample({
      status: 'REJECTED',
      approvedBy: '',
      approvedAt: '',
      rejectedBy: 'คุณวิชัย',
      rejectedByLineUserId: 'U-mgr',
      rejectedAt: '2026-08-03T03:30:00.000Z',
      rejectedReason: 'มีงานสำคัญในช่วงดังกล่าว',
    });

  it('includes the rejection reason and the actor', () => {
    const text = collectText(buildRejectedLeaveFlexMessage(rejected()).contents).join('\n');
    expect(text).toContain('มีงานสำคัญในช่วงดังกล่าว');
    expect(text).toContain('คุณวิชัย');
  });

  it('shows a collapsed Thai date range', () => {
    const text = collectText(buildRejectedLeaveFlexMessage(rejected()).contents).join('\n');
    expect(text).toContain('10–11 สิงหาคม 2569');
  });
});

describe('text fallbacks', () => {
  it('approved fallback contains all details', () => {
    const t = approvedEmployeeText(sample());
    expect(t).toContain('REQ-20260803-A1B2C3D4');
    expect(t).toContain('นายสมชาย ใจดี');
    expect(t).toContain('EMP001');
    expect(t).toContain('ลาป่วย');
    expect(t).toContain('10 สิงหาคม 2569');
    expect(t).toContain('คุณวิชัย');
    expect(t).toContain('อนุมัติเรียบร้อย');
  });

  it('rejected fallback contains the reason and actor', () => {
    const t = rejectedEmployeeText(
      sample({
        status: 'REJECTED',
        rejectedBy: 'คุณวิชัย',
        rejectedAt: '2026-08-03T03:30:00.000Z',
        rejectedReason: 'มีงานสำคัญในช่วงดังกล่าว',
      }),
    );
    expect(t).toContain('มีงานสำคัญในช่วงดังกล่าว');
    expect(t).toContain('คุณวิชัย');
    expect(t).toContain('ไม่อนุมัติ');
  });
});
