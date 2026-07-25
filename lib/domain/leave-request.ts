/** Domain model for a leave request. Shared by repositories, routes and views. */

export const LEAVE_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUS)[number];

export const NOTIFICATION_STATUS = ['NOT_STARTED', 'PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[number];

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
  approvedBy: string;
  approvedAt: string;
  rejectedBy: string;
  rejectedAt: string;
  rejectedReason: string;
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
  'approvedBy',
  'approvedAt',
  'rejectedBy',
  'rejectedAt',
  'rejectedReason',
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
