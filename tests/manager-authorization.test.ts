import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  authorizeApprover,
  evaluateSource,
  isAllowedSource,
  isConfiguredManager,
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

describe('authorizeApprover (union of MANAGER_USER_IDS ∪ HR_ADMIN_USER_IDS)', () => {
  it('allows any configured manager as actorType=manager', () => {
    expect(authorizeApprover('Umgr1')).toEqual({ ok: true, actorType: 'manager' });
    expect(authorizeApprover('Umgr2')).toEqual({ ok: true, actorType: 'manager' });
  });

  it('allows any HR admin as actorType=hr_admin', () => {
    expect(authorizeApprover('Uhr1')).toEqual({ ok: true, actorType: 'hr_admin' });
    expect(authorizeApprover('Uhr2')).toEqual({ ok: true, actorType: 'hr_admin' });
  });

  it('denies a user in neither list', () => {
    const r = authorizeApprover('Uother');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_approver');
  });

  it('denies an empty user id', () => {
    expect(authorizeApprover('').ok).toBe(false);
  });

  it('does NOT depend on the request being assigned to the user (the old bug)', () => {
    // A manager whose id never equals request.managerLineUserId (a group id) is
    // still authorised now.
    expect(authorizeApprover('Umgr1').ok).toBe(true);
  });

  it('handles comma+space separated env with dedupe', () => {
    set('MANAGER_USER_IDS', 'Umgr1, Umgr1 ,Umgr3');
    expect(isConfiguredManager('Umgr3')).toBe(true);
    expect(authorizeApprover('Umgr3').ok).toBe(true);
  });

  it('strips surrounding quotes from env values', () => {
    set('MANAGER_USER_IDS', '"Umgr9","Umgr8"');
    expect(isConfiguredManager('Umgr9')).toBe(true);
    expect(isConfiguredManager('Umgr8')).toBe(true);
  });

  it('isHRAdmin reflects the env list', () => {
    expect(isHRAdmin('Uhr1')).toBe(true);
    expect(isHRAdmin('Umgr1')).toBe(false);
  });
});

describe('evaluateSource / isAllowedSource', () => {
  it('accepts the configured group (groupMatch=true)', () => {
    const s = evaluateSource({ type: 'group', groupId: 'Cgroup1' });
    expect(s).toEqual({ allowed: true, groupMatch: true, sourceType: 'group' });
    expect(isAllowedSource({ type: 'group', groupId: 'Cgroup1' })).toBe(true);
  });
  it('rejects a wrong group (groupMatch=false)', () => {
    const s = evaluateSource({ type: 'group', groupId: 'Cother' });
    expect(s.allowed).toBe(false);
    expect(s.groupMatch).toBe(false);
  });
  it('accepts a direct message', () => {
    expect(evaluateSource({ type: 'user' }).allowed).toBe(true);
  });
  it('rejects a room', () => {
    expect(evaluateSource({ type: 'room' }).allowed).toBe(false);
  });
});
