import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { emptyEvidenceMetadata, type LeaveEvidenceRecord } from '@/lib/evidence/types';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import type { FoundRequest } from '@/lib/repositories/leave-request-repository';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({ verifyIdentity: (...args: unknown[]) => verifyIdentityMock(...args) }));
const findByRequestIdMock = vi.fn<() => Promise<FoundRequest | null>>();
vi.mock('@/lib/repositories/leave-request-repository', () => ({ findByRequestId: () => findByRequestIdMock() }));
const listByRequestIdMock = vi.fn<() => Promise<LeaveEvidenceRecord[]>>();
const findByEvidenceIdMock = vi.fn<() => Promise<LeaveEvidenceRecord | null>>();
vi.mock('@/lib/repositories/leave-evidence-repository', () => ({
  listByRequestId: () => listByRequestIdMock(),
  findByEvidenceId: () => findByEvidenceIdMock(),
}));
const appendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/repositories/audit-log-repository', () => ({ append: (...args: unknown[]) => appendMock(...args) }));
const readEvidenceMock = vi.fn<() => Promise<Buffer | null>>();
vi.mock('@/lib/evidence/storage', () => ({ readEvidence: () => readEvidenceMock() }));

import { GET as listEvidence } from '@/app/api/leave/[requestId]/evidence/route';
import { GET as streamEvidence } from '@/app/api/leave/[requestId]/evidence/[evidenceId]/route';

const ENV_KEYS = ['MANAGER_USER_IDS', 'HR_ADMIN_USER_IDS', 'LEAVE_EVIDENCE_DIR'] as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.MANAGER_USER_IDS = 'U-mgr';
  process.env.HR_ADMIN_USER_IDS = 'U-hr';
  process.env.LEAVE_EVIDENCE_DIR = '/tmp/evidence';
});
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function request(token: string | null): Request {
  return new Request('http://localhost/api/leave/REQ-1/evidence', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}
const listContext = { params: Promise.resolve({ requestId: 'REQ-1' }) };
const streamContext = (evidenceId: string) => ({ params: Promise.resolve({ requestId: 'REQ-1', evidenceId }) });

function found(overrides: Partial<LeaveRequest> = {}): FoundRequest {
  return {
    request: {
      ...emptyEvidenceMetadata(), requestId: 'REQ-1', createdAt: '2026-08-28T00:00:00Z',
      evidenceStatus: 'AVAILABLE', evidenceRelativePath: 'S2A001/REQ-1/legacy.jpg',
      evidenceMimeType: 'image/jpeg', evidenceOriginalFileName: 'legacy.jpg', evidenceSize: 100,
      ...overrides,
    } as LeaveRequest,
    rowNumber: 2,
    header: [],
  };
}
const RECORD: LeaveEvidenceRecord = {
  evidenceId: 'EVD-1', requestId: 'REQ-1', employeeId: 'S2A001', originalName: 'new.pdf',
  storedName: 'stored.pdf', mimeType: 'application/pdf', size: 200,
  relativePath: 'S2A001/REQ-1/stored.pdf', uploadedAt: '2026-08-28T01:00:00Z', status: 'AVAILABLE', sha256: 'abc',
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: 'U-mgr' } });
  findByRequestIdMock.mockResolvedValue(found());
  listByRequestIdMock.mockResolvedValue([]);
  findByEvidenceIdMock.mockResolvedValue(RECORD);
  readEvidenceMock.mockResolvedValue(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]));
});

describe('GET evidence list', () => {
  it('normalizes legacy single evidence to a one-item list', async () => {
    const response = await listEvidence(request('manager'), listContext);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.items).toEqual([expect.objectContaining({ evidenceId: 'legacy', legacy: true, originalName: 'legacy.jpg' })]);
    expect(JSON.stringify(body)).not.toContain('relativePath');
  });

  it('returns all new evidence rows instead of duplicating the legacy summary', async () => {
    listByRequestIdMock.mockResolvedValue([RECORD, { ...RECORD, evidenceId: 'EVD-2', originalName: 'photo.png' }]);
    const body = await (await listEvidence(request('manager'), listContext)).json();
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.every((item: { legacy: boolean }) => !item.legacy)).toBe(true);
  });

  it('allows HR and denies a non-approver', async () => {
    verifyIdentityMock.mockResolvedValueOnce({ ok: true, identity: { lineUserId: 'U-hr' } });
    expect((await listEvidence(request('hr'), listContext)).status).toBe(200);
    verifyIdentityMock.mockResolvedValueOnce({ ok: true, identity: { lineUserId: 'U-no' } });
    expect((await listEvidence(request('no'), listContext)).status).toBe(403);
  });

  it('returns 401 without token and 404 without evidence', async () => {
    expect((await listEvidence(request(null), listContext)).status).toBe(401);
    findByRequestIdMock.mockResolvedValue(found({ evidenceStatus: 'NONE', evidenceRelativePath: '' }));
    expect((await listEvidence(request('manager'), listContext)).status).toBe(404);
  });
});

describe('GET individual evidence file', () => {
  it('streams a selected new file with secure headers and audit', async () => {
    const response = await streamEvidence(request('manager'), streamContext('EVD-1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('inline');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(appendMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'EVIDENCE_VIEWED' }));
  });

  it('streams a legacy file through the legacy id', async () => {
    const response = await streamEvidence(request('manager'), streamContext('legacy'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });

  it('allows HR, denies non-approver, and returns 404 for missing metadata/file', async () => {
    verifyIdentityMock.mockResolvedValueOnce({ ok: true, identity: { lineUserId: 'U-hr' } });
    expect((await streamEvidence(request('hr'), streamContext('EVD-1'))).status).toBe(200);
    verifyIdentityMock.mockResolvedValueOnce({ ok: true, identity: { lineUserId: 'U-no' } });
    expect((await streamEvidence(request('no'), streamContext('EVD-1'))).status).toBe(403);
    findByEvidenceIdMock.mockResolvedValueOnce(null);
    expect((await streamEvidence(request('manager'), streamContext('missing'))).status).toBe(404);
    readEvidenceMock.mockResolvedValueOnce(null);
    expect((await streamEvidence(request('manager'), streamContext('EVD-1'))).status).toBe(404);
  });
});
