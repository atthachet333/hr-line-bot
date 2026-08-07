import { describe, it, expect, afterEach } from 'vitest';
import { validateEnvironment, parseList } from '@/lib/env';

const KEYS = [
  'EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN',
  'MANAGER_LINE_CHANNEL_ACCESS_TOKEN',
  'MANAGER_LINE_CHANNEL_SECRET',
  'MANAGER_GROUP_ID',
  'MANAGER_USER_IDS',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_SHEET_ID',
  'GOOGLE_APPS_SCRIPT_URL',
  'APP_BASE_URL',
  'INTERNAL_API_SECRET',
  'NEXT_PUBLIC_LIFF_ID',
  'NEXT_PUBLIC_LIFF_ID_LEAVE',
  'NEXT_PUBLIC_LIFF_ID_BALANCE',
  'NEXT_PUBLIC_LIFF_ID_CHECKIN',
  'NEXT_PUBLIC_LIFF_ID_CHECKOUT',
  'EMPLOYEE_LINE_LOGIN_CHANNEL_ID',
];

const saved: Record<string, string | undefined> = {};
function set(key: string, value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(saved)) delete saved[k];
});

function goodProdEnv() {
  set('EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN', 'emp-token-1234567890');
  set('MANAGER_LINE_CHANNEL_ACCESS_TOKEN', 'mgr-token-1234567890');
  set('MANAGER_LINE_CHANNEL_SECRET', 'mgr-secret-1234567890');
  set('MANAGER_USER_IDS', 'Uaaa,Ubbb');
  set('GOOGLE_CLIENT_EMAIL', 'svc@project.iam.gserviceaccount.com');
  set('GOOGLE_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----');
  set('GOOGLE_SHEET_ID', 'sheet123');
  set('GOOGLE_APPS_SCRIPT_URL', 'https://script.google.com/macros/s/AAA/exec');
  set('APP_BASE_URL', 'https://hr.example.com');
  set('INTERNAL_API_SECRET', 'internal-secret-123');
  set('NEXT_PUBLIC_LIFF_ID', '2010618791-KY777Hrw');
  set('NEXT_PUBLIC_LIFF_ID_BALANCE', '2010618791-6K8d8hmx');
  set('NEXT_PUBLIC_LIFF_ID_CHECKIN', '2010618791-ybX6PWJy');
  set('NEXT_PUBLIC_LIFF_ID_CHECKOUT', '2010618791-9Cdcy05Z');
  set('EMPLOYEE_LINE_LOGIN_CHANNEL_ID', '2010618791');
}

describe('parseList', () => {
  it('splits, trims and dedupes', () => {
    expect(parseList('a, b ,a\nc')).toEqual(['a', 'b', 'c']);
    expect(parseList(undefined)).toEqual([]);
  });
});

describe('validateEnvironment', () => {
  it('dev mode passes with missing secrets (warnings only)', () => {
    for (const k of KEYS) set(k, undefined);
    const r = validateEnvironment({ production: false, requireSecrets: false });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('production requires secrets', () => {
    for (const k of KEYS) set(k, undefined);
    const r = validateEnvironment({ production: true, requireSecrets: true });
    expect(r.ok).toBe(false);
  });

  it('accepts a well-formed production env', () => {
    goodProdEnv();
    const r = validateEnvironment({ production: true, requireSecrets: true });
    expect(r.ok).toBe(true);
  });

  it('rejects a non-HTTPS URL in production', () => {
    goodProdEnv();
    set('APP_BASE_URL', 'http://hr.example.com');
    const r = validateEnvironment({ production: true, requireSecrets: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('HTTPS');
  });

  it('rejects localhost in production', () => {
    goodProdEnv();
    set('APP_BASE_URL', 'https://localhost:3000');
    const r = validateEnvironment({ production: true, requireSecrets: true });
    expect(r.ok).toBe(false);
  });

  it('rejects identical employee/manager tokens', () => {
    goodProdEnv();
    set('EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN', 'same-token-1234567890');
    set('MANAGER_LINE_CHANNEL_ACCESS_TOKEN', 'same-token-1234567890');
    const r = validateEnvironment({ production: true, requireSecrets: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('ต้องไม่เหมือนกัน');
  });

  it('rejects a placeholder value', () => {
    goodProdEnv();
    set('GOOGLE_SHEET_ID', 'YOUR_SHEET_ID');
    const r = validateEnvironment({ production: true, requireSecrets: true });
    expect(r.ok).toBe(false);
  });

  it('rejects a missing page LIFF id in production', () => {
    goodProdEnv();
    set('NEXT_PUBLIC_LIFF_ID_CHECKIN', undefined);
    const r = validateEnvironment({ production: true, requireSecrets: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('LIFF ID');
  });

  it('rejects LIFF ids from different LINE Login channels', () => {
    goodProdEnv();
    set('NEXT_PUBLIC_LIFF_ID_BALANCE', '9999999999-otherchan');
    const r = validateEnvironment({ production: true, requireSecrets: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('channel');
  });

  it('rejects a LIFF prefix that mismatches EMPLOYEE_LINE_LOGIN_CHANNEL_ID', () => {
    goodProdEnv();
    set('EMPLOYEE_LINE_LOGIN_CHANNEL_ID', '1111111111');
    const r = validateEnvironment({ production: true, requireSecrets: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('EMPLOYEE_LINE_LOGIN_CHANNEL_ID');
  });
});
