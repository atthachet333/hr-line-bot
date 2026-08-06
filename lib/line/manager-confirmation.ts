import type { LeaveRequest, LeaveStatus } from '@/lib/domain/leave-request';
import { formatThaiDateRange, formatThaiDateTime } from '@/lib/utils/datetime';

/**
 * Text confirmations shown IN the manager group after a decision. These are the
 * manager-facing acknowledgements (separate from the employee result message).
 * All values come from the server-verified record + resolved manager name —
 * never from client/postback input.
 */

const STATUS_TH: Record<LeaveStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

function employeeLine(req: LeaveRequest): string {
  const id = req.employeeId ? ` (${req.employeeId})` : '';
  return `${req.employeeName || '-'}${id}`;
}

/** "✅ อนุมัติการลาสำเร็จ" confirmation for the group. */
export function buildApproveGroupConfirmation(
  req: LeaveRequest,
  managerName: string,
  atIso: string,
): string {
  return (
    `✅ อนุมัติการลาสำเร็จ\n\n` +
    `เลขคำขอ: ${req.requestId}\n` +
    `พนักงาน: ${employeeLine(req)}\n` +
    `ประเภทลา: ${req.leaveType}\n` +
    `วันที่ลา: ${formatThaiDateRange(req.startDate, req.endDate)}\n` +
    `จำนวน: ${req.totalDays} วัน\n` +
    `อนุมัติโดย: ${managerName}\n` +
    `เวลา: ${formatThaiDateTime(atIso)}`
  );
}

/** "❌ ไม่อนุมัติคำขอลาสำเร็จ" confirmation for the group. */
export function buildRejectGroupConfirmation(
  req: LeaveRequest,
  managerName: string,
  reason: string,
  atIso: string,
): string {
  return (
    `❌ ไม่อนุมัติคำขอลาสำเร็จ\n\n` +
    `เลขคำขอ: ${req.requestId}\n` +
    `พนักงาน: ${employeeLine(req)}\n` +
    `ประเภทลา: ${req.leaveType}\n` +
    `วันที่ลา: ${formatThaiDateRange(req.startDate, req.endDate)}\n` +
    `เหตุผล: ${reason || 'ไม่ระบุเหตุผล'}\n` +
    `ดำเนินการโดย: ${managerName}\n` +
    `เวลา: ${formatThaiDateTime(atIso)}`
  );
}

/** "ℹ️ คำขอนี้ถูกดำเนินการไปแล้ว" shown when a button is pressed after the fact. */
export function buildAlreadyProcessedText(status: LeaveStatus): string {
  return (
    `ℹ️ คำขอนี้ถูกดำเนินการไปแล้ว\n` +
    `สถานะปัจจุบัน: ${STATUS_TH[status] ?? status}`
  );
}

/** Group message when the atomic transition itself failed (never claims success). */
export function buildTransitionFailedText(
  desiredStatus: Extract<LeaveStatus, 'APPROVED' | 'REJECTED'>,
): string {
  const verb = desiredStatus === 'APPROVED' ? 'อนุมัติ' : 'บันทึกการไม่อนุมัติ';
  return `❌ ไม่สามารถ${verb}คำขอได้\nกรุณาลองใหม่อีกครั้ง`;
}
