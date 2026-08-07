import { describe, it, expect, vi } from 'vitest';
import { resolveSessionCore, escalateReloginCore, type SessionDeps } from '@/lib/liff/session-core';

const LEAVE_HREF = 'https://s2aline.s2aconsultant.com/liff/leave?liff.state=%2F&x=1#h';

function makeDeps(over: Partial<SessionDeps> = {}) {
  const login = vi.fn();
  const logout = vi.fn();
  const markRelogin = vi.fn();
  const base: SessionDeps = {
    liffId: '2010618791-KY777Hrw',
    ensureInit: async () => true,
    isLoggedIn: () => true,
    ready: async () => {},
    getAccessToken: () => 'valid-token',
    login,
    logout,
    href: LEAVE_HREF,
    reloginPending: () => false,
    markRelogin,
  };
  // Tests only override the non-spy fields, so the spies stay observable.
  return Object.assign(base, over) as SessionDeps & {
    login: typeof login;
    logout: typeof logout;
    markRelogin: typeof markRelogin;
  };
}

describe('resolveSessionCore', () => {
  it('returns ready with the fresh token when logged in', async () => {
    const d = makeDeps();
    const r = await resolveSessionCore(d);
    expect(r).toEqual({ status: 'ready', accessToken: 'valid-token' });
    expect(d.login).not.toHaveBeenCalled();
  });

  it('not logged in -> liff.login with canonical /liff/leave redirectUri', async () => {
    const d = makeDeps({ isLoggedIn: () => false });
    const r = await resolveSessionCore(d);
    expect(r.status).toBe('redirecting');
    expect(d.login).toHaveBeenCalledTimes(1);
    expect(d.login).toHaveBeenCalledWith('https://s2aline.s2aconsultant.com/liff/leave');
  });

  it('logged in but access token null -> logout + login (guarded), marks relogin', async () => {
    const d = makeDeps({ getAccessToken: () => null });
    const r = await resolveSessionCore(d);
    expect(r.status).toBe('redirecting');
    expect(d.logout).toHaveBeenCalledTimes(1);
    expect(d.login).toHaveBeenCalledWith('https://s2aline.s2aconsultant.com/liff/leave');
    expect(d.markRelogin).toHaveBeenCalledTimes(1);
  });

  it('token null AND relogin already pending -> error (no loop, no logout)', async () => {
    const d = makeDeps({ getAccessToken: () => null, reloginPending: () => true });
    const r = await resolveSessionCore(d);
    expect(r).toEqual({ status: 'error', code: 'LIFF_ACCESS_TOKEN_MISSING' });
    expect(d.logout).not.toHaveBeenCalled();
    expect(d.login).not.toHaveBeenCalled();
  });

  it('missing LIFF id -> LIFF_INIT_FAILED', async () => {
    const d = makeDeps({ liffId: '' });
    expect(await resolveSessionCore(d)).toEqual({ status: 'error', code: 'LIFF_INIT_FAILED' });
  });

  it('init failure -> LIFF_INIT_FAILED', async () => {
    const d = makeDeps({ ensureInit: async () => false });
    expect(await resolveSessionCore(d)).toEqual({ status: 'error', code: 'LIFF_INIT_FAILED' });
  });
});

describe('escalateReloginCore (API 401 recovery)', () => {
  it('first call: logout + login once (re-login), redirecting', () => {
    const login = vi.fn();
    const logout = vi.fn();
    const markRelogin = vi.fn();
    const out = escalateReloginCore({ reloginPending: () => false, markRelogin, login, logout, href: LEAVE_HREF });
    expect(out).toBe('redirecting');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith('https://s2aline.s2aconsultant.com/liff/leave');
    expect(markRelogin).toHaveBeenCalledTimes(1);
  });

  it('second call (already pending): blocked, no logout/login (no infinite loop)', () => {
    const login = vi.fn();
    const logout = vi.fn();
    const markRelogin = vi.fn();
    const out = escalateReloginCore({ reloginPending: () => true, markRelogin, login, logout, href: LEAVE_HREF });
    expect(out).toBe('blocked');
    expect(login).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
});
