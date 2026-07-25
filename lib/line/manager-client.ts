import { env } from '@/lib/env';
import { getProfileDisplayName, pushMessage, replyMessage } from './client-core';
import type { LineApiResult, LineMessage } from './types';

/**
 * Manager bot client. Sends the leave-request Flex Message to the manager group
 * (or, if no group is configured, to each configured manager user id).
 */
export async function notifyManagers(messages: LineMessage[]): Promise<LineApiResult> {
  const token = env.managerChannelAccessToken();
  const groupId = env.managerGroupId();

  if (groupId) {
    return pushMessage(token, groupId, messages);
  }

  const userIds = env.managerUserIds();
  if (userIds.length === 0) {
    return {
      ok: false,
      status: 0,
      error: 'No MANAGER_GROUP_ID or MANAGER_USER_IDS configured',
    };
  }

  // Push to every manager; succeed if at least one delivery works.
  const results = await Promise.all(userIds.map((id) => pushMessage(token, id, messages)));
  const okOne = results.find((r) => r.ok);
  if (okOne) return { ok: true, status: okOne.status };
  return results[0] ?? { ok: false, status: 0, error: 'No managers notified' };
}

/** Reply to a manager's postback (approve/reject) using the reply token. */
export function replyToManager(replyToken: string, messages: LineMessage[]): Promise<LineApiResult> {
  return replyMessage(env.managerChannelAccessToken(), replyToken, messages);
}

export function replyTextToManager(replyToken: string, text: string): Promise<LineApiResult> {
  return replyToManager(replyToken, [{ type: 'text', text }]);
}

/** Resolve a manager's LINE display name (best effort). */
export function getManagerDisplayName(userId: string): Promise<string> {
  return getProfileDisplayName(env.managerChannelAccessToken(), userId);
}
