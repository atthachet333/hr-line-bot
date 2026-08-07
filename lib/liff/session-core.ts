import { sanitizeRedirectUri } from './session-util';
import type { LiffClientErrorCode } from './error-messages';

/**
 * Pure LIFF session decision logic (no `liff`/DOM import) so the login /
 * re-login / loop-guard flow is unit-testable. `session.ts` injects the real
 * liff + window + sessionStorage.
 */

export type SessionCoreResult =
  | { status: 'ready'; accessToken: string }
  | { status: 'redirecting' }
  | { status: 'error'; code: Extract<LiffClientErrorCode, 'LIFF_INIT_FAILED' | 'LIFF_ACCESS_TOKEN_MISSING'> };

export interface SessionDeps {
  liffId: string;
  /** Idempotent init; resolves false on failure. */
  ensureInit: () => Promise<boolean>;
  isLoggedIn: () => boolean;
  ready: () => Promise<void>;
  getAccessToken: () => string | null;
  login: (redirectUri: string) => void;
  logout: () => void;
  /** Current URL (href). */
  href: string;
  /** True when a forced re-login is already pending (loop guard). */
  reloginPending: () => boolean;
  markRelogin: () => void;
}

/**
 * Resolve a usable session:
 *  1. init (LIFF_INIT_FAILED on failure / missing id)
 *  2. not logged in -> liff.login(canonical redirectUri) -> redirecting
 *  3. logged in but token null -> logout + login (guarded) -> redirecting,
 *     or LIFF_ACCESS_TOKEN_MISSING if a re-login was already tried (no loop)
 *  4. token present -> ready
 */
export async function resolveSessionCore(deps: SessionDeps): Promise<SessionCoreResult> {
  if (!deps.liffId) return { status: 'error', code: 'LIFF_INIT_FAILED' };
  if (!(await deps.ensureInit())) return { status: 'error', code: 'LIFF_INIT_FAILED' };

  if (!deps.isLoggedIn()) {
    deps.login(sanitizeRedirectUri(deps.href));
    return { status: 'redirecting' };
  }

  await deps.ready();

  const token = deps.getAccessToken();
  if (!token) {
    if (deps.reloginPending()) return { status: 'error', code: 'LIFF_ACCESS_TOKEN_MISSING' };
    deps.markRelogin();
    deps.logout();
    deps.login(sanitizeRedirectUri(deps.href));
    return { status: 'redirecting' };
  }
  return { status: 'ready', accessToken: token };
}

export interface EscalateDeps {
  reloginPending: () => boolean;
  markRelogin: () => void;
  login: (redirectUri: string) => void;
  logout: () => void;
  href: string;
}

/**
 * Force a fresh login (logout + login) after a persistent 401. Guarded so it
 * runs at most once until a successful API call clears the marker — returns
 * 'blocked' (caller shows an error) instead of looping.
 */
export function escalateReloginCore(deps: EscalateDeps): 'redirecting' | 'blocked' {
  if (deps.reloginPending()) return 'blocked';
  deps.markRelogin();
  deps.logout();
  deps.login(sanitizeRedirectUri(deps.href));
  return 'redirecting';
}
