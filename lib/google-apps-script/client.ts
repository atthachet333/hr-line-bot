import { env } from '@/lib/env';
import { appsScriptEnvelopeSchema, type AppsScriptEnvelope } from './schema';

const TIMEOUT_MS = 15_000;

export type AppsScriptResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server-only client for the Google Apps Script web app. The URL lives in
 * GOOGLE_APPS_SCRIPT_URL and must never be exposed to the browser.
 *
 * The Apps Script web app is called with the payload as query parameters and
 * responds with JSON. Handles timeout, HTTP status and JSON parse errors.
 */
export async function callAppsScript<T = unknown>(
  payload: Record<string, string | number | boolean | undefined>,
): Promise<AppsScriptResult<T>> {
  const baseUrl = env.googleAppsScriptUrl();
  if (!baseUrl) {
    return { ok: false, error: 'GOOGLE_APPS_SCRIPT_URL is not configured', status: 0 };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const url = `${baseUrl}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow', cache: 'no-store' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Apps Script request failed: ${message}`, status: 0 };
  }

  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      error: `Apps Script HTTP ${res.status}: ${text.slice(0, 300)}`,
      status: res.status,
    };
  }

  if (text.trim() === '') {
    return { ok: false, error: 'Apps Script returned an empty body', status: res.status };
  }
  // Detect HTML (login page / error page) which Apps Script sometimes returns.
  if (/^\s*<(?:!doctype|html)/i.test(text)) {
    return { ok: false, error: 'Apps Script returned HTML instead of JSON', status: res.status };
  }

  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return {
      ok: false,
      error: `Apps Script returned non-JSON response: ${text.slice(0, 300)}`,
      status: res.status,
    };
  }
}

export type EnvelopeResult =
  | { ok: true; envelope: AppsScriptEnvelope }
  | {
      ok: false;
      kind: 'transport' | 'http' | 'invalid_json' | 'invalid_contract' | 'not_configured';
      status: number;
      error: string;
    };

/**
 * Call an Apps Script action and validate the standard response contract.
 * Returns `ok:true` with the envelope whenever a well-formed contract response
 * is received (even if `envelope.success` is false); the caller inspects
 * `envelope.code`. Transport / HTTP / JSON / schema failures are `ok:false`.
 */
export async function callAppsScriptEnvelope(
  payload: Record<string, string | number | boolean | undefined>,
): Promise<EnvelopeResult> {
  const raw = await callAppsScript<unknown>(payload);
  if (!raw.ok) {
    const kind = raw.status === 0
      ? (raw.error.includes('not configured') ? 'not_configured' : 'transport')
      : raw.status >= 400
        ? 'http'
        : 'invalid_json';
    return { ok: false, kind, status: raw.status, error: raw.error };
  }

  const coerced = coerceLegacyEnvelope(raw.data);
  const parsed = appsScriptEnvelopeSchema.safeParse(coerced);
  if (!parsed.success) {
    return {
      ok: false,
      kind: 'invalid_contract',
      status: 200,
      error: `Apps Script response did not match contract: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    };
  }
  return { ok: true, envelope: parsed.data };
}

/**
 * Accept both the new contract ({success, code, ...}) and the legacy shape
 * ({status: 'success'|'error', message, data}) so the app keeps working during
 * the Apps Script migration.
 */
function coerceLegacyEnvelope(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const obj = data as Record<string, unknown>;
  if (typeof obj.success === 'boolean') return obj; // already new contract
  if (typeof obj.status === 'string') {
    const success = obj.status === 'success';
    return {
      success,
      code: success ? 'OK' : 'ERROR',
      message: typeof obj.message === 'string' ? obj.message : undefined,
      data: obj.data ?? obj,
    };
  }
  return obj;
}
