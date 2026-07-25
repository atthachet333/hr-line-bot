import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { ExternalServiceError } from '@/lib/errors';
import { callAppsScriptEnvelope } from './client';
import { transitionDataSchema, type TransitionData } from './schema';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import type { LeaveStatus } from '@/lib/domain/leave-request';

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
  const { requestId, desiredStatus, actorLineUserId, actorName, reason, correlationId } = input;

  if (!env.googleAppsScriptUrl()) {
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
          approvedAt: new Date().toISOString(),
        }
      : {
          status: 'REJECTED' as const,
          rejectedBy: input.actorName,
          rejectedAt: new Date().toISOString(),
          rejectedReason: input.reason ?? '',
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
        approvedAt: res.request.approvedAt,
        rejectedBy: res.request.rejectedBy,
        rejectedAt: res.request.rejectedAt,
        rejectedReason: res.request.rejectedReason,
      },
    };
  }
  if (res.reason === 'not_found') return { outcome: 'not_found' };
  return { outcome: 'already_processed', currentStatus: res.current?.status };
}
