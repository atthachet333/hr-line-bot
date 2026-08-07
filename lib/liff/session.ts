'use client';

import liff from '@line/liff';
import { getLiffIdForPage, type LiffPage } from './config';
import { sanitizeRedirectUri, maskLiffId } from './session-util';
import { resolveSessionCore, escalateReloginCore, type SessionCoreResult } from './session-core';
import type { LiffClientErrorCode } from './error-messages';

export type LiffSession = SessionCoreResult;

export class LiffAuthError extends Error {
  constructor(public readonly code: LiffClientErrorCode) {
    super(code);
    this.name = 'LiffAuthError';
  }
}

// Per page-load module state: liff.init must run once.
let initialized = false;

/** Safe, masked client diagnostics — never logs token, full id, or query. */
function diag(page: LiffPage, phase: string, extra: Record<string, unknown>): void {
  try {
    console.debug('[liff]', JSON.stringify({ page, phase, liffId: maskLiffId(getLiffIdForPage(page)), ...extra }));
  } catch {
    /* ignore */
  }
}

// ---- re-login loop guard (survives the login redirect via sessionStorage) ----
function reloginKey(page: LiffPage): string {
  return `hrliff:relogin:${page}`;
}
function reloginPending(page: LiffPage): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(reloginKey(page)) === '1';
  } catch {
    return false;
  }
}
function markRelogin(page: LiffPage): void {
  try {
    sessionStorage.setItem(reloginKey(page), '1');
  } catch {
    /* ignore */
  }
}
/** Clear the guard — call ONLY after a successful authenticated response. */
export function clearReloginMark(page: LiffPage): void {
  try {
    sessionStorage.removeItem(reloginKey(page));
  } catch {
    /* ignore */
  }
}
export function isReloginPending(page: LiffPage): boolean {
  return reloginPending(page);
}

async function ensureInit(liffId: string, page: LiffPage): Promise<boolean> {
  if (initialized) return true;
  try {
    await liff.init({ liffId });
    initialized = true;
    return true;
  } catch {
    diag(page, 'init', { code: 'LIFF_INIT_FAILED' });
    return false;
  }
}

function href(): string {
  return typeof window !== 'undefined' ? window.location.href : '';
}

/**
 * Ensure a usable LIFF session for `page` (init → login/re-login → fresh token).
 * Uses the pure core for the decision so it is loop-safe and testable.
 */
async function ensureSession(page: LiffPage): Promise<LiffSession> {
  const liffId = getLiffIdForPage(page);
  return resolveSessionCore({
    liffId,
    ensureInit: () => ensureInit(liffId, page),
    isLoggedIn: () => liff.isLoggedIn(),
    ready: async () => {
      try {
        await liff.ready;
      } catch {
        /* best-effort */
      }
    },
    getAccessToken: () => liff.getAccessToken(),
    login: (redirectUri) => {
      diag(page, 'login', {
        pathname: typeof window !== 'undefined' ? window.location.pathname : '',
        redirectUri,
      });
      liff.login({ redirectUri });
    },
    logout: () => {
      diag(page, 'relogin', { pathname: typeof window !== 'undefined' ? window.location.pathname : '' });
      try {
        liff.logout();
      } catch {
        /* ignore */
      }
    },
    href: href(),
    reloginPending: () => reloginPending(page),
    markRelogin: () => markRelogin(page),
  });
}

export function initializeLiffSession(page: LiffPage): Promise<LiffSession> {
  return ensureSession(page);
}

/** Force a fresh read of the session/token (used by the 401 recovery path). */
export function reinitializeLiffSession(page: LiffPage): Promise<LiffSession> {
  return ensureSession(page);
}

/**
 * Escalate after a persistent 401: logout + fresh login, guarded so it runs at
 * most once until a successful API call clears the marker. Returns 'redirecting'
 * (navigating to login) or 'blocked' (already tried — caller shows an error).
 */
export function escalateRelogin(page: LiffPage): 'redirecting' | 'blocked' {
  return escalateReloginCore({
    reloginPending: () => reloginPending(page),
    markRelogin: () => markRelogin(page),
    login: (redirectUri) => {
      diag(page, 'escalate-login', { redirectUri });
      liff.login({ redirectUri });
    },
    logout: () => {
      try {
        liff.logout();
      } catch {
        /* ignore */
      }
    },
    href: href(),
  });
}

/** Return a fresh access token or throw a typed LiffAuthError. */
export async function getFreshLiffAccessToken(page: LiffPage): Promise<string> {
  const s = await ensureSession(page);
  if (s.status === 'ready') return s.accessToken;
  if (s.status === 'redirecting') throw new LiffAuthError('LIFF_LOGIN_REQUIRED');
  throw new LiffAuthError(s.code);
}

// re-export for convenience
export { sanitizeRedirectUri };
