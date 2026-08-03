import type { LeaveRequest } from '@/lib/domain/leave-request';
import { buildManagerFlexMessage } from '@/lib/line/flex-message';
import { notifyManagers } from '@/lib/line/manager-client';
import { pushToEmployee, pushTextToEmployee } from '@/lib/line/employee-client';
import { buildEmployeeResultMessages } from '@/lib/line/employee-result-flex';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import { logger } from '@/lib/logger';
import type { LineApiResult } from '@/lib/line/types';

export const MAX_NOTIFICATION_ATTEMPTS = 5;

/** Exponential backoff (ms) suggestion for the Nth attempt (for metadata/logs). */
export function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
}

/**
 * Send the manager Flex for a request and record the outcome in the split
 * managerNotification* fields. Marks PENDING before sending so a crash mid-send
 * is visible. Never creates or mutates the leave request itself.
 */
export async function sendManagerNotification(
  request: LeaveRequest,
  correlationId: string,
): Promise<LineApiResult> {
  await leaveRepo.setManagerNotification(request.requestId, {
    status: 'PENDING',
    incrementAttempt: true,
  });
  const result = await notifyManagers([buildManagerFlexMessage(request)]);
  await leaveRepo.setManagerNotification(request.requestId, {
    status: result.ok ? 'SENT' : 'FAILED',
    error: result.ok ? '' : (result.error ?? ''),
  });
  logger.info('manager_notification', {
    correlationId,
    leaveRequestId: request.requestId,
    event: 'notify_manager',
    result: result.ok ? 'ok' : 'error',
    code: result.ok ? undefined : String(result.status),
  });
  return result;
}

/**
 * Send the approval/rejection result to the employee and record the outcome in
 * the split employeeNotification* fields.
 */
export async function sendEmployeeNotification(
  request: LeaveRequest,
  correlationId: string,
): Promise<LineApiResult> {
  const { flex, text } = buildEmployeeResultMessages(request);

  await leaveRepo.setEmployeeNotification(request.requestId, {
    status: 'PENDING',
    incrementAttempt: true,
  });

  // Prefer the rich Flex Message; fall back to a full-detail text message if the
  // Flex delivery fails (e.g. malformed contents / API rejection).
  let result = await pushToEmployee(request.employeeLineUserId, [flex]);
  let usedFallback = false;
  if (!result.ok) {
    usedFallback = true;
    result = await pushTextToEmployee(request.employeeLineUserId, text);
  }

  await leaveRepo.setEmployeeNotification(request.requestId, {
    status: result.ok ? 'SENT' : 'FAILED',
    error: result.ok ? '' : (result.error ?? ''),
  });
  logger.info('employee_notification', {
    correlationId,
    leaveRequestId: request.requestId,
    event: 'notify_employee',
    result: result.ok ? 'ok' : 'error',
    fallback: usedFallback || undefined,
    code: result.ok ? undefined : String(result.status),
  });
  return result;
}
