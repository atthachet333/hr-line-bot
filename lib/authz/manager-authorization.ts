import { env } from '@/lib/env';
import type { LeaveRequest } from '@/lib/domain/leave-request';

export type ActorType = 'manager' | 'hr_admin';

export type AuthzResult =
  | { ok: true; actorType: ActorType }
  | { ok: false; reason: 'not_your_request' | 'no_manager_mapping' | 'not_a_manager' };

export function isHRAdmin(lineUserId: string): boolean {
  return env.hrAdminUserIds().includes(lineUserId);
}

/** Is this user a configured manager at all (in MANAGER_USER_IDS)? */
export function isConfiguredManager(lineUserId: string): boolean {
  return env.managerUserIds().includes(lineUserId);
}

/**
 * Decide whether `lineUserId` may approve/reject a specific request.
 *
 *  - HR admins may act on ANY request.
 *  - A normal manager may act only when they are the request's assigned manager
 *    (request.managerLineUserId === userId).
 *  - When a request has no managerLineUserId, only HR admins may act; a normal
 *    manager is denied with `no_manager_mapping` (caller should audit this).
 */
export function isAuthorisedManagerForRequest(
  lineUserId: string,
  request: Pick<LeaveRequest, 'managerLineUserId'>,
): AuthzResult {
  if (isHRAdmin(lineUserId)) {
    return { ok: true, actorType: 'hr_admin' };
  }
  if (!request.managerLineUserId) {
    return { ok: false, reason: 'no_manager_mapping' };
  }
  if (request.managerLineUserId === lineUserId) {
    return { ok: true, actorType: 'manager' };
  }
  return { ok: false, reason: 'not_your_request' };
}

/**
 * Validate the LINE source of a postback. When the manager bot operates in a
 * group, only the configured group may drive approvals. Direct 1:1 messages
 * from managers are allowed too.
 */
export function isAllowedSource(source: {
  type: 'user' | 'group' | 'room';
  groupId?: string;
}): boolean {
  const configuredGroup = env.managerGroupId();
  if (source.type === 'group') {
    // If a manager group is configured, the group id must match it.
    if (configuredGroup) return source.groupId === configuredGroup;
    // No group configured but event came from a group -> reject.
    return false;
  }
  if (source.type === 'room') return false;
  // Direct message from a user is allowed (per-user authz still applies).
  return true;
}
