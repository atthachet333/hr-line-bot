import { env } from '@/lib/env';

const VERIFY_ID_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/verify';
const VERIFY_ACCESS_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/verify';
const PROFILE_URL = 'https://api.line.me/v2/profile';
const TIMEOUT_MS = 10_000;

export interface VerifiedIdentity {
  lineUserId: string;
  displayName?: string;
}

export type IdentityResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; error: string };

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
 * Verify a LIFF ID token against LINE and return the authoritative LINE user id.
 * The `aud` of the token must match the configured Employee login channel id.
 */
export async function verifyLiffIdToken(idToken: string): Promise<IdentityResult> {
  const clientId = env.employeeLoginChannelId();
  if (!clientId) {
    return { ok: false, error: 'Employee login channel id is not configured' };
  }
  try {
    const res = await fetchWithTimeout(VERIFY_ID_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }).toString(),
    });
    if (!res.ok) {
      return { ok: false, error: `id_token verify failed (${res.status})` };
    }
    const data = (await res.json()) as { sub?: string; name?: string; aud?: string };
    if (!data.sub) {
      return { ok: false, error: 'id_token payload missing sub' };
    }
    return { ok: true, identity: { lineUserId: data.sub, displayName: data.name } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `id_token verify error: ${message}` };
  }
}

/**
 * Verify a LIFF access token and resolve the LINE user id via the profile API.
 * Used as a fallback when only an access token is available.
 */
export async function verifyLiffAccessToken(accessToken: string): Promise<IdentityResult> {
  try {
    const verifyRes = await fetchWithTimeout(
      `${VERIFY_ACCESS_TOKEN_URL}?access_token=${encodeURIComponent(accessToken)}`,
      { method: 'GET' },
    );
    if (!verifyRes.ok) {
      return { ok: false, error: `access_token verify failed (${verifyRes.status})` };
    }
    const profileRes = await fetchWithTimeout(PROFILE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      return { ok: false, error: `profile fetch failed (${profileRes.status})` };
    }
    const profile = (await profileRes.json()) as { userId?: string; displayName?: string };
    if (!profile.userId) {
      return { ok: false, error: 'profile missing userId' };
    }
    return {
      ok: true,
      identity: { lineUserId: profile.userId, displayName: profile.displayName },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `access_token verify error: ${message}` };
  }
}

/**
 * Verify whichever token the client supplied. Prefers the id token; if it is
 * absent or fails to verify (e.g. issued for a different LIFF/login channel),
 * falls back to the access token + profile lookup when one was provided.
 */
export async function verifyIdentity(input: {
  idToken?: string;
  accessToken?: string;
}): Promise<IdentityResult> {
  if (input.idToken) {
    const result = await verifyLiffIdToken(input.idToken);
    if (result.ok || !input.accessToken) return result;
  }
  if (input.accessToken) return verifyLiffAccessToken(input.accessToken);
  return { ok: false, error: 'No LINE token supplied' };
}
