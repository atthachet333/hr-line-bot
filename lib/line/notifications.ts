import type { LeaveRequest } from '@/lib/domain/leave-request';
import { formatThaiDateTime } from '@/lib/utils/datetime';

/** Employee-facing message after a request is approved. */
export function approvedEmployeeText(req: LeaveRequest): string {
  const approver = req.approvedBy || 'หัวหน้างาน';
  return (
    `✅ คำขอลางาน ${req.requestId} ได้รับการอนุมัติแล้ว\n\n` +
    `ประเภท: ${req.leaveType}\n` +
    `วันที่: ${req.startDate} ถึง ${req.endDate} (${req.totalDays} วัน)\n` +
    `ผู้อนุมัติ: ${approver}\n` +
    `วันที่อนุมัติ: ${formatThaiDateTime(req.approvedAt || req.updatedAt)}`
  );
}

/** Employee-facing message after a request is rejected. */
export function rejectedEmployeeText(req: LeaveRequest): string {
  const actor = req.rejectedBy || 'หัวหน้างาน';
  const reason = req.rejectedReason || 'ไม่ระบุเหตุผล';
  return (
    `❌ คำขอลางาน ${req.requestId} ไม่ได้รับการอนุมัติ\n\n` +
    `ประเภท: ${req.leaveType}\n` +
    `วันที่: ${req.startDate} ถึง ${req.endDate}\n` +
    `ผู้ดำเนินการ: ${actor}\n` +
    `เหตุผล: ${reason}\n` +
    `วันที่ดำเนินการ: ${formatThaiDateTime(req.rejectedAt || req.updatedAt)}`
  );
}
