import type { LineApiResult, LineMessage } from './types';

const LINE_API = 'https://api.line.me/v2/bot';
const TIMEOUT_MS = 10_000;

async function callLine(
  path: string,
  accessToken: string,
  payload: unknown,
): Promise<LineApiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${LINE_API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (res.ok) return { ok: true, status: res.status };

    // Read the error body so we can log a safe summary. Never log the token.
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      status: res.status,
      error: `LINE API ${res.status}: ${detail.slice(0, 500)}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: `LINE request failed: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a bot-scoped display name for a user id. Returns '' on any failure. */
export async function getProfileDisplayName(
  accessToken: string,
  userId: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${LINE_API}/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { displayName?: string };
    return data.displayName ?? '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Push a message to a user/group/room. */
export function pushMessage(
  accessToken: string,
  to: string,
  messages: LineMessage[],
): Promise<LineApiResult> {
  return callLine('/message/push', accessToken, { to, messages });
}

/** Reply to a webhook event using its replyToken. */
export function replyMessage(
  accessToken: string,
  replyToken: string,
  messages: LineMessage[],
): Promise<LineApiResult> {
  return callLine('/message/reply', accessToken, { replyToken, messages });
}
