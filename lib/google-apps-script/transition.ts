import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { ExternalServiceError } from '@/lib/errors';
import { callAppsScriptEnvelope } from './client';
import { transitionDataSchema, type TransitionData } from './schema';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import type { ApprovalSource, LeaveStatus } from '@/lib/domain/leave-request';

export type TransitionOutcome =
  | { outcome: 'updated'; previousStatus: string; currentStatus: string; data: TransitionData }
  | { outcome: 'already_processed'; currentStatus?: string }
  | { outcome: 'not_found' };

export interface TransitionInput {
  requestId: string;
  desiredStatus: Extract<LeaveStatus, 'APPROVED' | 'REJECTED'>;
  actorLineUserId: string;
  actorName: string;
  reason?: string;
  /** Origin of the decision (LINE_MANAGER_BOT | HR_ADMIN). */
  approvalSource: Extract<ApprovalSource, 'LINE_MANAGER_BOT' | 'HR_ADMIN'>;
  correlationId: string;
}

/**
 * Atomically transition a leave request out of PENDING.
 *
 * Preferred path: Google Apps Script `transitionLeaveStatus` action, which uses
 * `LockService.getScriptLock()` to serialise concurrent approvals across
 * instances/processes (the only correct approach for Google Sheets).
 *
 * Fallback path (only when GOOGLE_APPS_SCRIPT_URL is not configured): the direct
 * service-account repository, which uses a read-check-write guard. This is a
 * best-effort fallback and is NOT race-proof — logged as a warning.
 */
export async function atomicTransition(input: TransitionInput): Promise<TransitionOutcome> {
  const { requestId, desiredStatus, actorLineUserId, actorName, reason, approvalSource, correlationId } =
    input;

  if (!env.googleAppsScriptUrl()) {
    // Production must never fall back to the non-atomic read-check-write path.
    // Keep the request PENDING and surface SERVICE_UNAVAILABLE to the caller.
    if (env.isProduction() && !env.allowNonAtomicTransition()) {
      logger.error('transition_atomic_unavailable', {
        correlationId,
        leaveRequestId: requestId,
        event: 'atomic_transition',
        detail: 'GOOGLE_APPS_SCRIPT_URL not configured and non-atomic fallback disabled',
      });
      throw new ExternalServiceError(
        'ระบบไม่พร้อมอัปเดตสถานะในขณะนี้ กรุณาลองใหม่ภายหลัง',
        'atomic transition unavailable (SERVICE_UNAVAILABLE)',
      );
    }
    logger.warn('transition_fallback_repository', {
      correlationId,
      leaveRequestId: requestId,
      event: 'atomic_transition',
      detail: 'GOOGLE_APPS_SCRIPT_URL not configured; using non-atomic repository fallback',
    });
    return repositoryFallback(input);
  }

  const result = await callAppsScriptEnvelope({
    action: 'transitionLeaveStatus',
    requestId,
    desiredStatus,
    actorLineUserId,
    actorName,
    reason: reason ?? '',
    approvalSource,
  });

  if (!result.ok) {
    logger.error('transition_apps_script_error', {
      correlationId,
      leaveRequestId: requestId,
      event: 'atomic_transition',
      code: result.kind,
      detail: result.error.slice(0, 300),
    });
    throw new ExternalServiceError(
      'ไม่สามารถอัปเดตสถานะได้ในขณะนี้ กรุณาลองใหม่',
      `apps_script ${result.kind}: ${result.error}`,
    );
  }

  const { code, data } = result.envelope;
  switch (code) {
    case 'STATUS_UPDATED': {
      const parsed = transitionDataSchema.safeParse(data);
      if (!parsed.success) {
        throw new ExternalServiceError(
          'ไม่สามารถอ่านผลการอัปเดตสถานะได้',
          'transition data failed schema',
        );
      }
      return {
        outcome: 'updated',
        previousStatus: parsed.data.previousStatus ?? 'PENDING',
        currentStatus: parsed.data.currentStatus ?? desiredStatus,
        data: parsed.data,
      };
    }
    case 'ALREADY_PROCESSED': {
      const parsed = transitionDataSchema.safeParse(data ?? {});
      return { outcome: 'already_processed', currentStatus: parsed.success ? parsed.data.currentStatus : undefined };
    }
    case 'REQUEST_NOT_FOUND':
      return { outcome: 'not_found' };
    default:
      throw new ExternalServiceError(
        'ไม่สามารถอัปเดตสถานะได้ (unknown response)',
        `unknown apps_script code: ${code}`,
      );
  }
}

async function repositoryFallback(input: TransitionInput): Promise<TransitionOutcome> {
  const patch =
    input.desiredStatus === 'APPROVED'
      ? {
          status: 'APPROVED' as const,
          approvedBy: input.actorName,
          approvedByLineUserId: input.actorLineUserId,
          approvedAt: new Date().toISOString(),
          approvalSource: input.approvalSource,
        }
      : {
          status: 'REJECTED' as const,
          rejectedBy: input.actorName,
          rejectedByLineUserId: input.actorLineUserId,
          rejectedAt: new Date().toISOString(),
          rejectedReason: input.reason ?? '',
          approvalSource: input.approvalSource,
        };

  const res = await leaveRepo.transitionFromPending(input.requestId, patch);
  if (res.ok) {
    return {
      outcome: 'updated',
      previousStatus: 'PENDING',
      currentStatus: res.request.status,
      data: {
        requestId: input.requestId,
        previousStatus: 'PENDING',
        currentStatus: res.request.status,
        approvedBy: res.request.approvedBy,
        approvedByLineUserId: res.request.approvedByLineUserId,
        approvedAt: res.request.approvedAt,
        rejectedBy: res.request.rejectedBy,
        rejectedByLineUserId: res.request.rejectedByLineUserId,
        rejectedAt: res.request.rejectedAt,
        rejectedReason: res.request.rejectedReason,
        approvalSource: res.request.approvalSource,
      },
    };
  }
  if (res.reason === 'not_found') return { outcome: 'not_found' };
  return { outcome: 'already_processed', currentStatus: res.current?.status };
}
