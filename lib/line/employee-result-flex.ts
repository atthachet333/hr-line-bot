import type { LeaveRequest } from '@/lib/domain/leave-request';
import { formatThaiDate, formatThaiDateRange, formatThaiDateTime } from '@/lib/utils/datetime';
import type { LineFlexMessage } from './types';

/**
 * Employee-facing result messages (Flex + text fallback) sent after a manager
 * approves or rejects a leave request. All approver identity comes from the
 * server-verified record — never from client/postback input.
 *
 * UI: mobile-friendly, roomy spacing, clear status header, request id, and
 * separators between the employee / leave-detail / approver sections. Approved
 * uses a calm green tone; rejected uses a muted red. Multi-line reasons wrap.
 */

const APPROVED = {
  headerBg: '#15803d', // green-700
  accent: '#166534',
  emoji: '✅',
  title: 'คำขอลาได้รับการอนุมัติแล้ว',
  statusLabel: 'อนุมัติเรียบร้อย',
} as const;

const REJECTED = {
  headerBg: '#b91c1c', // red-700
  accent: '#991b1b',
  emoji: '❌',
  title: 'คำขอลาไม่ได้รับการอนุมัติ',
  statusLabel: 'ไม่อนุมัติ',
} as const;

function infoRow(label: string, value: string) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#8c8c8c', size: 'sm', flex: 4 },
      { type: 'text', text: value || '-', wrap: true, color: '#111111', size: 'sm', flex: 6 },
    ],
  };
}

function separator() {
  return { type: 'separator', margin: 'lg' };
}

/** Multi-line reason rendered as a stack of wrapped text lines. */
function reasonBlock(title: string, reason: string) {
  const lines = (reason || '-').split(/\r?\n/);
  return {
    type: 'box',
    layout: 'vertical',
    margin: 'lg',
    spacing: 'xs',
    contents: [
      { type: 'text', text: title, color: '#8c8c8c', size: 'sm' },
      ...lines.map((line) => ({
        type: 'text',
        text: line || ' ',
        wrap: true,
        color: '#111111',
        size: 'sm',
      })),
    ],
  };
}

function bubble(
  theme: typeof APPROVED | typeof REJECTED,
  req: LeaveRequest,
  detailContents: object[],
): LineFlexMessage['contents'] {
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: theme.headerBg,
      paddingAll: '16px',
      spacing: 'xs',
      contents: [
        { type: 'text', text: `${theme.emoji} ${theme.title}`, color: '#ffffff', weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: `เลขคำขอ: ${req.requestId}`, color: '#ffffff', size: 'xs', margin: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        infoRow('ชื่อพนักงาน', req.employeeName),
        infoRow('รหัสพนักงาน', req.employeeId),
        infoRow('ตำแหน่ง', req.position),
        infoRow('แผนก', req.department),
        separator(),
        ...detailContents,
        separator(),
      ],
    },
  };
}

/** Flex Message: leave request APPROVED. */
export function buildApprovedLeaveFlexMessage(req: LeaveRequest): LineFlexMessage {
  const approver = req.approvedBy || 'ผู้บริหาร';
  const detail = [
    infoRow('ประเภทการลา', req.leaveType),
    infoRow('วันที่เริ่มลา', formatThaiDate(req.startDate)),
    infoRow('วันที่สิ้นสุด', formatThaiDate(req.endDate)),
    infoRow('จำนวนวันลา', `${req.totalDays} วัน`),
    reasonBlock('เหตุผล', req.reason),
  ];
  const contents = bubble(APPROVED, req, detail) as Record<string, unknown>;
  (contents.body as { contents: object[] }).contents.push(
    infoRow('อนุมัติโดย', approver),
    infoRow('วันที่อนุมัติ', formatThaiDateTime(req.approvedAt || req.updatedAt)),
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      margin: 'md',
      contents: [
        { type: 'text', text: 'สถานะ', color: '#8c8c8c', size: 'sm', flex: 4 },
        { type: 'text', text: APPROVED.statusLabel, weight: 'bold', color: APPROVED.accent, size: 'sm', flex: 6 },
      ],
    },
  );
  return {
    type: 'flex',
    altText: `✅ คำขอลา ${req.requestId} ได้รับการอนุมัติแล้ว`,
    contents,
  };
}

/** Flex Message: leave request REJECTED. */
export function buildRejectedLeaveFlexMessage(req: LeaveRequest): LineFlexMessage {
  const actor = req.rejectedBy || 'ผู้บริหาร';
  const detail = [
    infoRow('ประเภทการลา', req.leaveType),
    infoRow('วันที่', formatThaiDateRange(req.startDate, req.endDate)),
    infoRow('จำนวนวันลา', `${req.totalDays} วัน`),
    reasonBlock('เหตุผลที่ไม่อนุมัติ', req.rejectedReason || 'ไม่ระบุเหตุผล'),
  ];
  const contents = bubble(REJECTED, req, detail) as Record<string, unknown>;
  (contents.body as { contents: object[] }).contents.push(
    infoRow('ดำเนินการโดย', actor),
    infoRow('วันที่ดำเนินการ', formatThaiDateTime(req.rejectedAt || req.updatedAt)),
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      margin: 'md',
      contents: [
        { type: 'text', text: 'สถานะ', color: '#8c8c8c', size: 'sm', flex: 4 },
        { type: 'text', text: REJECTED.statusLabel, weight: 'bold', color: REJECTED.accent, size: 'sm', flex: 6 },
      ],
    },
  );
  return {
    type: 'flex',
    altText: `❌ คำขอลา ${req.requestId} ไม่ได้รับการอนุมัติ`,
    contents,
  };
}

/** Plain-text fallback used when the Flex Message cannot be delivered. */
export function approvedEmployeeText(req: LeaveRequest): string {
  const approver = req.approvedBy || 'ผู้บริหาร';
  return (
    `✅ คำขอลาได้รับการอนุมัติแล้ว\n\n` +
    `เลขคำขอ: ${req.requestId}\n` +
    `ชื่อพนักงาน: ${req.employeeName}\n` +
    `รหัสพนักงาน: ${req.employeeId}\n` +
    `ตำแหน่ง: ${req.position}\n` +
    `แผนก: ${req.department}\n\n` +
    `ประเภทการลา: ${req.leaveType}\n` +
    `วันที่เริ่มลา: ${formatThaiDate(req.startDate)}\n` +
    `วันที่สิ้นสุด: ${formatThaiDate(req.endDate)}\n` +
    `จำนวนวันลา: ${req.totalDays} วัน\n\n` +
    `เหตุผล:\n${req.reason || '-'}\n\n` +
    `อนุมัติโดย: ${approver}\n` +
    `วันที่อนุมัติ: ${formatThaiDateTime(req.approvedAt || req.updatedAt)}\n\n` +
    `สถานะ: ${APPROVED.statusLabel}`
  );
}

/** Plain-text fallback used when the Flex Message cannot be delivered. */
export function rejectedEmployeeText(req: LeaveRequest): string {
  const actor = req.rejectedBy || 'ผู้บริหาร';
  const reason = req.rejectedReason || 'ไม่ระบุเหตุผล';
  return (
    `❌ คำขอลาไม่ได้รับการอนุมัติ\n\n` +
    `เลขคำขอ: ${req.requestId}\n` +
    `ชื่อพนักงาน: ${req.employeeName}\n` +
    `รหัสพนักงาน: ${req.employeeId}\n` +
    `แผนก: ${req.department}\n\n` +
    `ประเภทการลา: ${req.leaveType}\n` +
    `วันที่: ${formatThaiDateRange(req.startDate, req.endDate)}\n` +
    `จำนวนวันลา: ${req.totalDays} วัน\n\n` +
    `เหตุผลที่ไม่อนุมัติ:\n${reason}\n\n` +
    `ดำเนินการโดย: ${actor}\n` +
    `วันที่ดำเนินการ: ${formatThaiDateTime(req.rejectedAt || req.updatedAt)}\n\n` +
    `สถานะ: ${REJECTED.statusLabel}`
  );
}

/** Build the result message (Flex) + its text fallback for an employee. */
export function buildEmployeeResultMessages(req: LeaveRequest): {
  flex: LineFlexMessage;
  text: string;
} {
  if (req.status === 'APPROVED') {
    return { flex: buildApprovedLeaveFlexMessage(req), text: approvedEmployeeText(req) };
  }
  return { flex: buildRejectedLeaveFlexMessage(req), text: rejectedEmployeeText(req) };
}
