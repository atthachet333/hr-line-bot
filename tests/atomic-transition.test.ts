import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EnvelopeResult } from '@/lib/google-apps-script/client';

const callMock = vi.fn<() => Promise<EnvelopeResult>>();
vi.mock('@/lib/google-apps-script/client', () => ({
  callAppsScriptEnvelope: (...args: unknown[]) => callMock(...(args as [])),
}));

import { atomicTransition } from '@/lib/google-apps-script/transition';
import { ExternalServiceError } from '@/lib/errors';

const savedUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
beforeEach(() => {
  process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AAA/exec';
  callMock.mockReset();
});
afterEach(() => {
  if (savedUrl === undefined) delete process.env.GOOGLE_APPS_SCRIPT_URL;
  else process.env.GOOGLE_APPS_SCRIPT_URL = savedUrl;
});

const base = {
  requestId: 'REQ-20260725-ABCD1234',
  actorLineUserId: 'Umgr',
  actorName: 'หัวหน้า',
  approvalSource: 'LINE_MANAGER_BOT' as const,
  correlationId: 'cid',
};

describe('atomicTransition', () => {
  it('maps STATUS_UPDATED to updated', async () => {
    callMock.mockResolvedValue({
      ok: true,
      envelope: {
        success: true,
        code: 'STATUS_UPDATED',
        data: { requestId: base.requestId, previousStatus: 'PENDING', currentStatus: 'APPROVED' },
      },
    });
    const r = await atomicTransition({ ...base, desiredStatus: 'APPROVED' });
    expect(r.outcome).toBe('updated');
    if (r.outcome === 'updated') expect(r.currentStatus).toBe('APPROVED');
  });

  it('maps ALREADY_PROCESSED', async () => {
    callMock.mockResolvedValue({
      ok: true,
      envelope: { success: false, code: 'ALREADY_PROCESSED', data: { requestId: base.requestId, currentStatus: 'APPROVED' } },
    });
    const r = await atomicTransition({ ...base, desiredStatus: 'REJECTED' });
    expect(r.outcome).toBe('already_processed');
    if (r.outcome === 'already_processed') expect(r.currentStatus).toBe('APPROVED');
  });

  it('maps REQUEST_NOT_FOUND', async () => {
    callMock.mockResolvedValue({ ok: true, envelope: { success: false, code: 'REQUEST_NOT_FOUND' } });
    const r = await atomicTransition({ ...base, desiredStatus: 'APPROVED' });
    expect(r.outcome).toBe('not_found');
  });

  it('throws on transport failure', async () => {
    callMock.mockResolvedValue({ ok: false, kind: 'transport', status: 0, error: 'timeout' });
    await expect(atomicTransition({ ...base, desiredStatus: 'APPROVED' })).rejects.toBeInstanceOf(ExternalServiceError);
  });
});
