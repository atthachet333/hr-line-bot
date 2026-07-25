import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isAuthorisedManagerForRequest,
  isAllowedSource,
  isHRAdmin,
} from '@/lib/authz/manager-authorization';

const saved: Record<string, string | undefined> = {};
function set(key: string, value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  set('HR_ADMIN_USER_IDS', 'Uhr1,Uhr2');
  set('MANAGER_USER_IDS', 'Umgr1,Umgr2');
  set('MANAGER_GROUP_ID', 'Cgroup1');
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(saved)) delete saved[k];
});

describe('isAuthorisedManagerForRequest', () => {
  it('allows the assigned manager', () => {
    const r = isAuthorisedManagerForRequest('Umgr1', { managerLineUserId: 'Umgr1' });
    expect(r).toEqual({ ok: true, actorType: 'manager' });
  });

  it('denies a different manager', () => {
    const r = isAuthorisedManagerForRequest('Umgr2', { managerLineUserId: 'Umgr1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_your_request');
  });

  it('allows an HR admin to override any request', () => {
    const r = isAuthorisedManagerForRequest('Uhr1', { managerLineUserId: 'Umgr1' });
    expect(r).toEqual({ ok: true, actorType: 'hr_admin' });
  });

  it('denies a normal manager when there is no manager mapping', () => {
    const r = isAuthorisedManagerForRequest('Umgr1', { managerLineUserId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_manager_mapping');
  });

  it('allows HR admin even without manager mapping', () => {
    const r = isAuthorisedManagerForRequest('Uhr2', { managerLineUserId: '' });
    expect(r.ok).toBe(true);
  });

  it('isHRAdmin reflects the env list', () => {
    expect(isHRAdmin('Uhr1')).toBe(true);
    expect(isHRAdmin('Umgr1')).toBe(false);
  });
});

describe('isAllowedSource', () => {
  it('accepts the configured group', () => {
    expect(isAllowedSource({ type: 'group', groupId: 'Cgroup1' })).toBe(true);
  });
  it('rejects a wrong group', () => {
    expect(isAllowedSource({ type: 'group', groupId: 'Cother' })).toBe(false);
  });
  it('accepts a direct message', () => {
    expect(isAllowedSource({ type: 'user' })).toBe(true);
  });
  it('rejects a room', () => {
    expect(isAllowedSource({ type: 'room' })).toBe(false);
  });
});
