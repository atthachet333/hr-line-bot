import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { emptyEvidenceMetadata } from '@/lib/evidence/types';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import type { FoundRequest } from '@/lib/repositories/leave-request-repository';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({ verifyIdentity: (...a: unknown[]) => verifyIdentityMock(...a) }));

const findByRequestIdMock = vi.fn<() => Promise<FoundRequest | null>>();
vi.mock('@/lib/repositories/leave-request-repository', () => ({
  findByRequestId: () => findByRequestIdMock(),
}));

const appendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/repositories/audit-log-repository', () => ({ append: (...a: unknown[]) => appendMock(...a) }));

const readEvidenceMock = vi.fn<() => Promise<Buffer | null>>();
vi.mock('@/lib/evidence/storage', () => ({ readEvidence: () => readEvidenceMock() }));

import { GET } from '@/app/api/leave/[requestId]/evidence/route';

const ENV_KEYS = ['MANAGER_USER_IDS', 'HR_ADMIN_USER_IDS', 'LEAVE_EVIDENCE_DIR'] as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.MANAGER_USER_IDS = 'U-mgr';
  process.env.HR_ADMIN_USER_IDS = 'U-hr';
  process.env.LEAVE_EVIDENCE_DIR = '/tmp/evidence';
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function reqWith(token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('http://localhost:3333/api/leave/REQ-1/evidence', { headers });
}
const ctx = { params: Promise.resolve({ requestId: 'REQ-1' }) };

function withEvidence(overrides: Partial<LeaveRequest> = {}): FoundRequest {
  const request = {
    ...emptyEvidenceMetadata(),
    requestId: 'REQ-1', evidenceStatus: 'AVAILABLE', evidenceRelativePath: 'S2A001/REQ-1/f.jpg',
    evidenceMimeType: 'image/jpeg', evidenceOriginalFileName: 'note.jpg',
    ...overrides,
  } as unknown as LeaveRequest;
  return { request, rowNumber: 2, header: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: 'U-mgr' } });
  findByRequestIdMock.mockResolvedValue(withEvidence());
  readEvidenceMock.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
});

describe('GET /api/leave/:id/evidence', () => {
  it('streams inline for a manager with secure headers + audit', async () => {
    const res = await GET(reqWith('mgr-token'), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toContain('inline');
    expect(appendMock.mock.calls.some((c) => (c[0] as { action: string }).action === 'EVIDENCE_VIEWED')).toBe(true);
  });

  it('allows an HR admin', async () => {
    verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: 'U-hr' } });
    const res = await GET(reqWith('hr-token'), ctx);
    expect(res.status).toBe(200);
  });

  it('denies a non-approver (403) and does not read the file', async () => {
    verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: 'U-nobody' } });
    const res = await GET(reqWith('tok'), ctx);
    expect(res.status).toBe(403);
    expect(readEvidenceMock).not.toHaveBeenCalled();
  });

  it('401 without a token', async () => {
    const res = await GET(reqWith(null), ctx);
    expect(res.status).toBe(401);
    expect(verifyIdentityMock).not.toHaveBeenCalled();
  });

  it('404 when the request has no available evidence', async () => {
    findByRequestIdMock.mockResolvedValue(withEvidence({ evidenceStatus: 'NONE', evidenceRelativePath: '' }));
    const res = await GET(reqWith('mgr-token'), ctx);
    expect(res.status).toBe(404);
  });

  it('404 when the file is missing on disk', async () => {
    readEvidenceMock.mockResolvedValue(null);
    const res = await GET(reqWith('mgr-token'), ctx);
    expect(res.status).toBe(404);
  });
});
