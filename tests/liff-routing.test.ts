import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { liffRedirects } from '@/lib/liff/redirects';
import { sanitizeRedirectUri, canonicalPathname } from '@/lib/liff/session-util';

// ---- redirects (backwards-compat so old Rich Menu URLs never 404) ----

describe('liffRedirects', () => {
  const rules = liffRedirects();
  const find = (source: string) => rules.find((r) => r.source === source);

  it('maps short + hyphenated URLs to the real /liff routes', () => {
    expect(find('/checkin')?.destination).toBe('/liff/checkin');
    expect(find('/checkout')?.destination).toBe('/liff/checkout');
    expect(find('/leave')?.destination).toBe('/liff/leave');
    expect(find('/balance')?.destination).toBe('/liff/balance');
    expect(find('/liff/check-in')?.destination).toBe('/liff/checkin');
    expect(find('/liff/check-out')?.destination).toBe('/liff/checkout');
  });

  it('maps legacy clock-in/clock-out (one-directional) to real routes', () => {
    expect(find('/liff/clock-in')?.destination).toBe('/liff/checkin');
    expect(find('/liff/clock-out')?.destination).toBe('/liff/checkout');
    expect(find('/clock-in')?.destination).toBe('/liff/checkin');
    expect(find('/clock-out')?.destination).toBe('/liff/checkout');
  });

  it('never redirects the canonical routes (no reverse / no loop)', () => {
    const sources = new Set(rules.map((r) => r.source));
    for (const canonical of ['/liff/checkin', '/liff/checkout', '/liff/leave', '/liff/balance']) {
      expect(sources.has(canonical)).toBe(false); // canonical is never a redirect source
    }
    // No destination is itself a source (would be a redirect chain/loop).
    for (const r of rules) expect(sources.has(r.destination)).toBe(false);
  });

  it('every destination is a real /liff/* route and non-permanent during migration', () => {
    const valid = new Set(['/liff/checkin', '/liff/checkout', '/liff/leave', '/liff/balance']);
    for (const r of rules) {
      expect(valid.has(r.destination)).toBe(true);
      expect(r.permanent).toBe(false);
    }
  });
});

describe('sanitizeRedirectUri — canonical login round-trip', () => {
  it('checkin stays /liff/checkin', () => {
    expect(sanitizeRedirectUri('https://s2aline.s2aconsultant.com/liff/checkin?x=1#h')).toBe(
      'https://s2aline.s2aconsultant.com/liff/checkin',
    );
  });
  it('checkout stays /liff/checkout', () => {
    expect(sanitizeRedirectUri('https://s2aline.s2aconsultant.com/liff/checkout')).toBe(
      'https://s2aline.s2aconsultant.com/liff/checkout',
    );
  });
  it('legacy clock-in/clock-out are normalised to the real routes', () => {
    expect(sanitizeRedirectUri('https://s2aline.s2aconsultant.com/liff/clock-in')).toBe(
      'https://s2aline.s2aconsultant.com/liff/checkin',
    );
    expect(sanitizeRedirectUri('https://s2aline.s2aconsultant.com/liff/clock-out')).toBe(
      'https://s2aline.s2aconsultant.com/liff/checkout',
    );
  });
  it('canonicalPathname never turns checkin into clock-in (one-directional)', () => {
    expect(canonicalPathname('/liff/checkin')).toBe('/liff/checkin');
    expect(canonicalPathname('/liff/checkout')).toBe('/liff/checkout');
    expect(canonicalPathname('/liff/clock-in')).toBe('/liff/checkin');
  });
});

// ---- LIFF config helper (env-driven; re-imported per scenario) ----

const LIFF_KEYS = [
  'NEXT_PUBLIC_LIFF_ID',
  'NEXT_PUBLIC_LIFF_ID_LEAVE',
  'NEXT_PUBLIC_LIFF_ID_BALANCE',
  'NEXT_PUBLIC_LIFF_ID_CHECKIN',
  'NEXT_PUBLIC_LIFF_ID_CHECKOUT',
  'NEXT_PUBLIC_LIFF_ID_EVIDENCE',
  'NEXT_PUBLIC_LIFF_ID_MANAGER',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of LIFF_KEYS) saved[k] = process.env[k];
  vi.resetModules();
});
afterEach(() => {
  for (const k of LIFF_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function importConfig() {
  return import('@/lib/liff/config');
}

describe('getLiffIdForPage', () => {
  it('maps each page to its configured LIFF id', async () => {
    process.env.NEXT_PUBLIC_LIFF_ID_CHECKIN = '2010618791-ybX6PWJy';
    process.env.NEXT_PUBLIC_LIFF_ID_CHECKOUT = '2010618791-9Cdcy05Z';
    process.env.NEXT_PUBLIC_LIFF_ID = '2010618791-KY777Hrw';
    process.env.NEXT_PUBLIC_LIFF_ID_BALANCE = '2010618791-6K8d8hmx';
    delete process.env.NEXT_PUBLIC_LIFF_ID_LEAVE;

    const cfg = await importConfig();
    expect(cfg.getLiffIdForPage('checkin')).toBe('2010618791-ybX6PWJy');
    expect(cfg.getLiffIdForPage('checkout')).toBe('2010618791-9Cdcy05Z');
    expect(cfg.getLiffIdForPage('leave')).toBe('2010618791-KY777Hrw');
    expect(cfg.getLiffIdForPage('balance')).toBe('2010618791-6K8d8hmx');
    expect(cfg.allLiffIdsConfigured()).toBe(true);
  });

  it('leave falls back to NEXT_PUBLIC_LIFF_ID when the leave-specific var is unset', async () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID_LEAVE;
    process.env.NEXT_PUBLIC_LIFF_ID = '2010618791-KY777Hrw';
    const cfg = await importConfig();
    expect(cfg.getLiffIdForPage('leave')).toBe('2010618791-KY777Hrw');
  });

  it('returns "" (clear failure) when a page env is missing', async () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID_BALANCE;
    const cfg = await importConfig();
    expect(cfg.getLiffIdForPage('balance')).toBe('');
    expect(cfg.allLiffIdsConfigured()).toBe(false);
  });

  it('builds canonical route + LIFF deep-link URLs', async () => {
    const cfg = await importConfig();
    expect(cfg.canonicalUrl('balance')).toBe('https://s2aline.s2aconsultant.com/liff/balance');
    expect(cfg.canonicalUrl('checkin')).toBe('https://s2aline.s2aconsultant.com/liff/checkin');
    expect(cfg.liffUrl('2010618791-6K8d8hmx')).toBe('https://liff.line.me/2010618791-6K8d8hmx');
  });

  it('evidenceViewerUrl uses the evidence LIFF deep link (query form) when configured', async () => {
    process.env.NEXT_PUBLIC_LIFF_ID_EVIDENCE = '2010618791-Mgr00000';
    const cfg = await importConfig();
    expect(cfg.evidenceViewerUrl('REQ-1')).toBe('https://liff.line.me/2010618791-Mgr00000?requestId=REQ-1');
    delete process.env.NEXT_PUBLIC_LIFF_ID_EVIDENCE;
  });

  it('evidenceViewerUrl falls back to the canonical route (query form) when no evidence LIFF id', async () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID_EVIDENCE;
    delete process.env.NEXT_PUBLIC_LIFF_ID_MANAGER;
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    delete process.env.NEXT_PUBLIC_LIFF_ID_LEAVE;
    const cfg = await importConfig();
    expect(cfg.evidenceViewerUrl('REQ-1')).toBe('https://s2aline.s2aconsultant.com/liff/evidence?requestId=REQ-1');
  });
});
