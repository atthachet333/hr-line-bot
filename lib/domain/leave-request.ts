/** Domain model for a leave request. Shared by repositories, routes and views. */

import type { EvidenceStatus } from '@/lib/evidence/types';

export const LEAVE_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUS)[number];

export const NOTIFICATION_STATUS = ['NOT_STARTED', 'PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[number];

/** Where an approval / rejection originated from (for audit). */
export const APPROVAL_SOURCE = ['LINE_MANAGER_BOT', 'HR_ADMIN'] as const;
export type ApprovalSource = (typeof APPROVAL_SOURCE)[number] | '';

export interface LeaveRequest {
  requestId: string;
  /** Client-supplied idempotency key (dedupes retries of the same submission). */
  clientRequestId: string;
  employeeLineUserId: string;
  employeeId: string;
  employeeName: string;
  position: string;
  department: string;
  leaveType: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalDays: number;
  reason: string;
  managerLineUserId: string;
  status: LeaveStatus;
  /** Display name of the approver (resolved server-side from LINE, never client). */
  approvedBy: string;
  /** LINE user id of the approver (from event.source.userId, server-verified). */
  approvedByLineUserId: string;
  approvedAt: string;
  /** Display name of the actor who rejected (resolved server-side from LINE). */
  rejectedBy: string;
  /** LINE user id of the rejecter (from event.source.userId, server-verified). */
  rejectedByLineUserId: string;
  rejectedAt: string;
  rejectedReason: string;
  /** Origin of the decision, e.g. LINE_MANAGER_BOT | HR_ADMIN. */
  approvalSource: ApprovalSource;
  createdAt: string;
  updatedAt: string;

  // ---- Manager notification (Flex to manager) ----
  managerNotificationStatus: NotificationStatus;
  managerNotificationAttempts: number;
  managerNotificationLastAttemptAt: string;
  managerNotificationError: string;

  // ---- Employee notification (approval/rejection result) ----
  employeeNotificationStatus: NotificationStatus;
  employeeNotificationAttempts: number;
  employeeNotificationLastAttemptAt: string;
  employeeNotificationError: string;

  // ---- Optional evidence attachment (never binary/base64/absolute path) ----
  evidenceStatus: EvidenceStatus;
  evidenceOriginalFileName: string;
  evidenceStoredFileName: string;
  evidenceRelativePath: string;
  evidenceMimeType: string;
  evidenceSize: number;
  evidenceUploadedAt: string;
  evidenceSha256: string;
}

/** Canonical column order for the LeaveRequests sheet (header row). */
export const LEAVE_REQUEST_COLUMNS: (keyof LeaveRequest)[] = [
  'requestId',
  'clientRequestId',
  'employeeLineUserId',
  'employeeId',
  'employeeName',
  'position',
  'department',
  'leaveType',
  'startDate',
  'endDate',
  'totalDays',
  'reason',
  'managerLineUserId',
  'status',
  'approvedByLineUserId',
  'approvedBy',
  'approvedAt',
  'rejectedByLineUserId',
  'rejectedBy',
  'rejectedAt',
  'rejectedReason',
  'approvalSource',
  'createdAt',
  'updatedAt',
  'managerNotificationStatus',
  'managerNotificationAttempts',
  'managerNotificationLastAttemptAt',
  'managerNotificationError',
  'employeeNotificationStatus',
  'employeeNotificationAttempts',
  'employeeNotificationLastAttemptAt',
  'employeeNotificationError',
  'evidenceStatus',
  'evidenceOriginalFileName',
  'evidenceStoredFileName',
  'evidenceRelativePath',
  'evidenceMimeType',
  'evidenceSize',
  'evidenceUploadedAt',
  'evidenceSha256',
];

/** Evidence columns (added by migration; the sheet may not have them yet). */
export const LEAVE_REQUEST_EVIDENCE_COLUMNS: (keyof LeaveRequest)[] = [
  'evidenceStatus',
  'evidenceOriginalFileName',
  'evidenceStoredFileName',
  'evidenceRelativePath',
  'evidenceMimeType',
  'evidenceSize',
  'evidenceUploadedAt',
  'evidenceSha256',
];

/** Core columns required for the sheet to be considered valid (evidence is optional). */
export const LEAVE_REQUEST_CORE_COLUMNS: (keyof LeaveRequest)[] = LEAVE_REQUEST_COLUMNS.filter(
  (c) => !(LEAVE_REQUEST_EVIDENCE_COLUMNS as string[]).includes(c),
);

/** Field keys that hold numeric values (used by the repository row mapper). */
export const LEAVE_REQUEST_NUMERIC_FIELDS: (keyof LeaveRequest)[] = [
  'totalDays',
  'managerNotificationAttempts',
  'employeeNotificationAttempts',
  'evidenceSize',
];
