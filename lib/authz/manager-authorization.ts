import { env } from '@/lib/env';

export type ActorType = 'manager' | 'hr_admin';

export type ApproverAuthz =
  | { ok: true; actorType: ActorType }
  | { ok: false; reason: 'not_approver' };

export function isHRAdmin(lineUserId: string): boolean {
  return !!lineUserId && env.hrAdminUserIds().includes(lineUserId);
}

/** Is this user a configured manager (in MANAGER_USER_IDS)? */
export function isConfiguredManager(lineUserId: string): boolean {
  return !!lineUserId && env.managerUserIds().includes(lineUserId);
}

/**
 * Approval authority is the UNION of MANAGER_USER_IDS ∪ HR_ADMIN_USER_IDS.
 *
 * Any user in either list may approve/reject any request that arrives from the
 * allowed source (group). We deliberately do NOT tie a normal manager to
 * `request.managerLineUserId`: in a group workflow that field is set to the
 * manager GROUP id, so it could never equal an individual manager's user id —
 * which is exactly why every manager was being told "คุณไม่มีสิทธิ์".
 *
 * HR admins are reported as `hr_admin` (used for the audit `HR_ADMIN_OVERRIDE`
 * marker); everyone else in the manager list is a `manager`.
 */
export function authorizeApprover(lineUserId: string): ApproverAuthz {
  if (isHRAdmin(lineUserId)) return { ok: true, actorType: 'hr_admin' };
  if (isConfiguredManager(lineUserId)) return { ok: true, actorType: 'manager' };
  return { ok: false, reason: 'not_approver' };
}

export interface SourceCheck {
  allowed: boolean;
  /** True when the event came from the configured MANAGER_GROUP_ID. */
  groupMatch: boolean;
  sourceType: 'user' | 'group' | 'room';
}

/**
 * Validate the LINE source of a postback and report why. When a manager group is
 * configured, only that group may drive approvals. Direct 1:1 messages from a
 * user are allowed (the per-user approver check still applies). Rooms are never
 * allowed.
 */
export function evaluateSource(source: {
  type: 'user' | 'group' | 'room';
  groupId?: string;
}): SourceCheck {
  const configuredGroup = env.managerGroupId();
  if (source.type === 'group') {
    const groupMatch = !!configuredGroup && source.groupId === configuredGroup;
    return { allowed: groupMatch, groupMatch, sourceType: 'group' };
  }
  if (source.type === 'room') {
    return { allowed: false, groupMatch: false, sourceType: 'room' };
  }
  return { allowed: true, groupMatch: false, sourceType: 'user' };
}

/** Boolean convenience wrapper around {@link evaluateSource}. */
export function isAllowedSource(source: { type: 'user' | 'group' | 'room'; groupId?: string }): boolean {
  return evaluateSource(source).allowed;
}
