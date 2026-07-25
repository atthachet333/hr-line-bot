import { isValidRequestId } from '@/lib/utils/request-id';
import { isValidRejectReasonCode, type RejectReasonCode } from '@/lib/domain/reject-reasons';

export type PostbackAction = 'approve' | 'reject' | 'reject_reason';

export type ParsedPostback =
  | { action: 'approve'; requestId: string }
  | { action: 'reject'; requestId: string }
  | { action: 'reject_reason'; requestId: string; reasonCode: RejectReasonCode };

/** Build the postback data string carried by a button. No secrets included. */
export function buildPostbackData(
  action: PostbackAction,
  requestId: string,
  reasonCode?: string,
): string {
  const params = new URLSearchParams({ action, requestId });
  if (reasonCode) params.set('reason', reasonCode);
  return params.toString();
}

/**
 * Parse & validate a postback data string. Returns null when malformed or the
 * action/requestId/reason are not recognised.
 */
export function parsePostbackData(data: string): ParsedPostback | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(data);
  } catch {
    return null;
  }
  const action = params.get('action');
  const requestId = params.get('requestId');

  if (!requestId || !isValidRequestId(requestId)) return null;

  if (action === 'approve') return { action, requestId };
  if (action === 'reject') return { action, requestId };
  if (action === 'reject_reason') {
    const reasonCode = params.get('reason') ?? '';
    if (!isValidRejectReasonCode(reasonCode)) return null;
    return { action, requestId, reasonCode };
  }
  return null;
}
