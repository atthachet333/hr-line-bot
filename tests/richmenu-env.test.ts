import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  richMenuLiffByPage,
  richMenuDiagnostics,
  expectedRichMenuUris,
  liffDeepLink,
} from '@/lib/richmenu/env';

const FULL = {
  NEXT_PUBLIC_LIFF_ID_CHECKIN: '2010618791-ybX6PWJy',
  NEXT_PUBLIC_LIFF_ID_CHECKOUT: '2010618791-9Cdcy05Z',
  NEXT_PUBLIC_LIFF_ID_BALANCE: '2010618791-6K8d8hmx',
  NEXT_PUBLIC_LIFF_ID: '2010618791-KY777Hrw',
  EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN: 'emp-secret-token-xyz-1234567890',
} as unknown as NodeJS.ProcessEnv;

describe('richMenuLiffByPage', () => {
  it('maps each page and falls back leave -> NEXT_PUBLIC_LIFF_ID', () => {
    const liff = richMenuLiffByPage(FULL);
    expect(liff.checkin).toBe('2010618791-ybX6PWJy');
    expect(liff.checkout).toBe('2010618791-9Cdcy05Z');
    expect(liff.balance).toBe('2010618791-6K8d8hmx');
    expect(liff.leave).toBe('2010618791-KY777Hrw'); // fallback
  });

  it('prefers NEXT_PUBLIC_LIFF_ID_LEAVE when set', () => {
    const liff = richMenuLiffByPage({ ...FULL, NEXT_PUBLIC_LIFF_ID_LEAVE: '2010618791-LEAVEID1' } as NodeJS.ProcessEnv);
    expect(liff.leave).toBe('2010618791-LEAVEID1');
  });

  it('reads from a provided env object (as @next/env would populate from .env.local)', () => {
    // Simulates loadEnvConfig having merged .env.local into an env object.
    const loaded = { NEXT_PUBLIC_LIFF_ID: '2010618791-KY777Hrw' } as unknown as NodeJS.ProcessEnv;
    expect(richMenuLiffByPage(loaded).leave).toBe('2010618791-KY777Hrw');
  });
});

describe('richMenuDiagnostics', () => {
  it('reports employee role, token boolean, count and missing pages', () => {
    const d = richMenuDiagnostics(FULL);
    expect(d.channelRole).toBe('employee');
    expect(d.tokenConfigured).toBe(true);
    expect(d.liffConfiguredCount).toBe(4);
    expect(d.missing).toEqual([]);
  });

  it('uses the EMPLOYEE token — a manager-only token does NOT count', () => {
    const d = richMenuDiagnostics({
      ...FULL,
      EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN: '',
      MANAGER_LINE_CHANNEL_ACCESS_TOKEN: 'mgr-token-should-be-ignored',
    } as NodeJS.ProcessEnv);
    expect(d.tokenConfigured).toBe(false);
  });

  it('never exposes the token value in diagnostics', () => {
    const d = richMenuDiagnostics(FULL);
    expect(JSON.stringify(d)).not.toContain('emp-secret-token-xyz-1234567890');
  });

  it('lists missing pages when LIFF ids are absent', () => {
    const d = richMenuDiagnostics({ NEXT_PUBLIC_LIFF_ID_CHECKIN: '2010618791-x' } as unknown as NodeJS.ProcessEnv);
    expect(d.liffConfiguredCount).toBe(1);
    expect(d.missing).toEqual(expect.arrayContaining(['checkout', 'leave', 'balance']));
  });
});

describe('@next/env loads .env.local (the scripts call this before reading env)', () => {
  it('populates NEXT_PUBLIC_* from a directory .env.local', async () => {
    const { loadEnvConfig } = await import('@next/env');
    const dir = mkdtempSync(path.join(tmpdir(), 'rmenv-'));
    writeFileSync(path.join(dir, '.env.local'), 'NEXT_PUBLIC_LIFF_ID=2010618791-FROMFILE\n');
    const savedKey = process.env.NEXT_PUBLIC_LIFF_ID;
    const savedNodeEnv = process.env.NODE_ENV;
    try {
      // @next/env skips .env.local when NODE_ENV==='test'; the scripts run under
      // tsx (development), so emulate that here.
      (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
      const silent = { info: () => {}, warn: () => {}, error: () => {} };
      const { combinedEnv } = loadEnvConfig(dir, true, silent, true);
      expect(combinedEnv?.NEXT_PUBLIC_LIFF_ID).toBe('2010618791-FROMFILE');
      // Resolver then sees it (leave falls back to NEXT_PUBLIC_LIFF_ID).
      expect(richMenuLiffByPage(process.env).leave).toBe('2010618791-FROMFILE');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
      if (savedKey === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
      else process.env.NEXT_PUBLIC_LIFF_ID = savedKey;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('expectedRichMenuUris', () => {
  it('includes each page LIFF deep link + canonical route (lowercased)', () => {
    const set = expectedRichMenuUris(FULL);
    expect(set.has(liffDeepLink('2010618791-6K8d8hmx').toLowerCase())).toBe(true);
    expect(set.has('https://s2aline.s2aconsultant.com/liff/balance')).toBe(true);
  });
});
