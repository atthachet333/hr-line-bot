import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseEvidenceRequestId } from '@/lib/liff/evidence-link';

const VALID = 'REQ-20260810-ABCD1234';

describe('parseEvidenceRequestId (Bug 3 — evidence deep link)', () => {
  it('reads ?requestId= (with or without leading ?)', () => {
    expect(parseEvidenceRequestId(`?requestId=${VALID}`)).toBe(VALID);
    expect(parseEvidenceRequestId(`requestId=${VALID}`)).toBe(VALID);
  });

  it('reads requestId nested inside liff.state', () => {
    const state = encodeURIComponent(`?requestId=${VALID}`);
    expect(parseEvidenceRequestId(`?liff.state=${state}`)).toBe(VALID);
  });

  it('rejects a malformed / traversal requestId', () => {
    expect(parseEvidenceRequestId('?requestId=REQ-bad')).toBe('');
    expect(parseEvidenceRequestId('?requestId=' + encodeURIComponent('../../secret'))).toBe('');
    expect(parseEvidenceRequestId('?requestId=REQ-20260810-abcd1234')).toBe(''); // lowercase not allowed
    expect(parseEvidenceRequestId('')).toBe('');
    expect(parseEvidenceRequestId(null)).toBe('');
  });
});

describe('evidenceViewerUrl (query form, no hardcoded domain)', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_LIFF_ID_EVIDENCE;
    vi.resetModules();
  });

  it('builds https://liff.line.me/<id>?requestId=<REQ> when the evidence LIFF id is set', async () => {
    process.env.NEXT_PUBLIC_LIFF_ID_EVIDENCE = '2010618791-EVID0001';
    vi.resetModules();
    const cfg = await import('@/lib/liff/config');
    const url = cfg.evidenceViewerUrl(VALID);
    expect(url).toBe(`https://liff.line.me/2010618791-EVID0001?requestId=${VALID}`);
    expect(url).not.toContain('localhost');
  });

  it('falls back to the canonical route (no hardcoded/localhost domain) when no evidence LIFF id', async () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID_EVIDENCE;
    delete process.env.NEXT_PUBLIC_LIFF_ID_MANAGER;
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    delete process.env.NEXT_PUBLIC_LIFF_ID_LEAVE;
    vi.resetModules();
    const cfg = await import('@/lib/liff/config');
    const url = cfg.evidenceViewerUrl(VALID);
    expect(url).toBe(`https://s2aline.s2aconsultant.com/liff/evidence?requestId=${VALID}`);
    expect(url).not.toContain('localhost');
  });
});
