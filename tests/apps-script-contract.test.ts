import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const saved = process.env.GOOGLE_APPS_SCRIPT_URL;
beforeEach(() => {
  process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AAA/exec';
});
afterEach(() => {
  if (saved === undefined) delete process.env.GOOGLE_APPS_SCRIPT_URL;
  else process.env.GOOGLE_APPS_SCRIPT_URL = saved;
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: string, contentType = 'application/json') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(body, { status, headers: { 'content-type': contentType } }),
    ),
  );
}

import { callAppsScriptEnvelope } from '@/lib/google-apps-script/client';

describe('Apps Script contract', () => {
  it('accepts a well-formed success envelope', async () => {
    mockFetch(200, JSON.stringify({ success: true, code: 'CHECK_IN_RECORDED', message: 'ok' }));
    const r = await callAppsScriptEnvelope({ action: 'checkin' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.code).toBe('CHECK_IN_RECORDED');
  });

  it('returns the envelope even when success is false (business failure)', async () => {
    mockFetch(200, JSON.stringify({ success: false, code: 'ALREADY_CHECKED_IN', message: 'dup' }));
    const r = await callAppsScriptEnvelope({ action: 'checkin' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.envelope.success).toBe(false);
      expect(r.envelope.code).toBe('ALREADY_CHECKED_IN');
    }
  });

  it('coerces the legacy {status, data} shape', async () => {
    mockFetch(200, JSON.stringify({ status: 'success', data: { empId: 'E1' } }));
    const r = await callAppsScriptEnvelope({ action: 'getBalance' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.success).toBe(true);
  });

  it('flags HTTP 500 as http error', async () => {
    mockFetch(500, 'server error', 'text/plain');
    const r = await callAppsScriptEnvelope({ action: 'checkin' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('http');
  });

  it('flags an HTML response', async () => {
    mockFetch(200, '<!doctype html><html>login</html>', 'text/html');
    const r = await callAppsScriptEnvelope({ action: 'checkin' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('invalid_json');
  });

  it('flags invalid JSON', async () => {
    mockFetch(200, '{ not json');
    const r = await callAppsScriptEnvelope({ action: 'checkin' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('invalid_json');
  });

  it('flags a contract mismatch (missing code)', async () => {
    mockFetch(200, JSON.stringify({ success: true }));
    const r = await callAppsScriptEnvelope({ action: 'checkin' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('invalid_contract');
  });

  it('treats a network failure as transport error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const r = await callAppsScriptEnvelope({ action: 'checkin' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('transport');
  });
});

describe('legacy Apps Script checkout source policy', () => {
  it('validates required summary before taking the Sheet lock or appending', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../google-apps-script/Code.gs', import.meta.url)),
      'utf8',
    );
    const handlerStart = source.indexOf('function recordAttendance(params, type)');
    const handler = source.slice(handlerStart);
    expect(handler).toContain("typeof params.summary !== 'string'");
    expect(handler).toContain("detail: 'WORK_SUMMARY_REQUIRED'");
    expect(handler).toContain("detail: 'WORK_SUMMARY_TOO_SHORT'");
    expect(handler).toContain("detail: 'WORK_SUMMARY_TOO_LONG'");
    expect(handler.indexOf("detail: 'WORK_SUMMARY_REQUIRED'")).toBeLessThan(handler.indexOf('LockService.getScriptLock()'));
    expect(handler).toContain("type === 'checkout' ? normalizedSummary : ''");
  });
});
