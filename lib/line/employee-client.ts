import { env } from '@/lib/env';
import { pushMessage } from './client-core';
import type { LineApiResult, LineMessage } from './types';

/**
 * Employee bot client. Used to notify employees of approval / rejection results.
 * Note: pushing to a user only works when the user has added the Employee bot as
 * a friend (or is otherwise in an allowed messaging context).
 */
export function pushToEmployee(userId: string, messages: LineMessage[]): Promise<LineApiResult> {
  return pushMessage(env.employeeChannelAccessToken(), userId, messages);
}

export function pushTextToEmployee(userId: string, text: string): Promise<LineApiResult> {
  return pushToEmployee(userId, [{ type: 'text', text }]);
}
