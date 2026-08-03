/** Domain model for a leave request. Shared by repositories, routes and views. */

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
];

/** Field keys that hold numeric values (used by the repository row mapper). */
export const LEAVE_REQUEST_NUMERIC_FIELDS: (keyof LeaveRequest)[] = [
  'totalDays',
  'managerNotificationAttempts',
  'employeeNotificationAttempts',
];
