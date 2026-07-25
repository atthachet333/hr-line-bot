import type { LeaveRequest, LeaveStatus } from '@/lib/domain/leave-request';
import { formatThaiDateTime } from '@/lib/utils/datetime';
import { buildPostbackData } from './postback';
import { REJECT_REASONS } from '@/lib/domain/reject-reasons';
import type { LineFlexMessage } from './types';

function row(label: string, value: string) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#8c8c8c', size: 'sm', flex: 3 },
      { type: 'text', text: value || '-', wrap: true, color: '#111111', size: 'sm', flex: 5 },
    ],
  };
}

const STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

const STATUS_COLOR: Record<LeaveStatus, string> = {
  PENDING: '#f59e0b',
  APPROVED: '#16a34a',
  REJECTED: '#dc2626',
  CANCELLED: '#6b7280',
};

/**
 * Build the Flex Message that the Manager bot sends for a new leave request.
 * The approve/reject buttons carry only the action + requestId — no secrets.
 */
export function buildManagerFlexMessage(req: LeaveRequest): LineFlexMessage {
  const isPending = req.status === 'PENDING';

  const footerButtons = isPending
    ? [
        {
          type: 'button',
          style: 'primary',
          color: '#16a34a',
          action: {
            type: 'postback',
            label: '✅ อนุมัติ',
            data: buildPostbackData('approve', req.requestId),
            displayText: `อนุมัติคำขอ ${req.requestId}`,
          },
        },
        {
          type: 'button',
          style: 'primary',
          color: '#dc2626',
          action: {
            type: 'postback',
            label: '❌ ไม่อนุมัติ',
            data: buildPostbackData('reject', req.requestId),
            displayText: `ไม่อนุมัติคำขอ ${req.requestId}`,
          },
        },
      ]
    : [
        {
          type: 'text',
          text: `สถานะ: ${STATUS_LABEL[req.status]}`,
          align: 'center',
          weight: 'bold',
          color: STATUS_COLOR[req.status],
          size: 'sm',
        },
      ];

  return {
    type: 'flex',
    altText: `คำขอลางาน ${req.requestId} จาก ${req.employeeName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#4f46e5',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '🔔 คำขอลางานใหม่', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: req.requestId, color: '#e0e7ff', size: 'xs', margin: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          row('พนักงาน', `${req.employeeName} (${req.employeeId})`),
          row('แผนก', [req.position, req.department].filter(Boolean).join(' / ')),
          row('ประเภท', req.leaveType),
          row('วันเริ่ม', req.startDate),
          row('วันสิ้นสุด', req.endDate),
          row('จำนวนวัน', `${req.totalDays} วัน`),
          row('เหตุผล', req.reason),
          row('ยื่นเมื่อ', formatThaiDateTime(req.createdAt)),
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            margin: 'md',
            contents: [
              { type: 'text', text: 'สถานะ', color: '#8c8c8c', size: 'sm', flex: 3 },
              {
                type: 'text',
                text: STATUS_LABEL[req.status],
                weight: 'bold',
                color: STATUS_COLOR[req.status],
                size: 'sm',
                flex: 5,
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: footerButtons,
      },
    },
  };
}

/**
 * Second-step Flex asking the manager to pick a rejection reason. Each button
 * carries action=reject_reason with the requestId + reason code (no secrets).
 */
export function buildRejectReasonFlex(requestId: string): LineFlexMessage {
  return {
    type: 'flex',
    altText: `เลือกเหตุผลการไม่อนุมัติ ${requestId}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: 'เลือกเหตุผลการไม่อนุมัติ', weight: 'bold', size: 'md' },
          { type: 'text', text: requestId, size: 'xs', color: '#8c8c8c' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: REJECT_REASONS.map((r) => ({
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: {
            type: 'postback',
            label: r.label,
            data: buildPostbackData('reject_reason', requestId, r.code),
            displayText: `ไม่อนุมัติ: ${r.label}`,
          },
        })),
      },
    },
  };
}
