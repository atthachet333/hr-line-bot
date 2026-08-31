import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Employee } from '@/lib/repositories/employee-repository';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import type { EnvelopeResult } from '@/lib/google-apps-script/client';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({ verifyIdentity: (...args: unknown[]) => verifyIdentityMock(...args) }));
const findByLineUserIdMock = vi.fn<() => Promise<Employee | null>>();
vi.mock('@/lib/repositories/employee-repository', () => ({ findByLineUserId: () => findByLineUserIdMock() }));
const createMock = vi.fn<(request: LeaveRequest) => Promise<void>>();
const setEvidenceMetadataMock = vi.fn();
vi.mock('@/lib/repositories/leave-request-repository', () => ({
  findByIdempotencyKey: vi.fn().mockResolvedValue(null),
  findOverlapping: vi.fn().mockResolvedValue(null),
  create: (request: LeaveRequest) => createMock(request),
  setEvidenceMetadata: (...args: unknown[]) => setEvidenceMetadataMock(...args),
}));
vi.mock('@/lib/repositories/audit-log-repository', () => ({ append: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/repositories/holiday-repository', () => ({ loadHolidays: () => Promise.resolve(new Set<string>()) }));
vi.mock('@/lib/services/notification-service', () => ({ sendManagerNotification: vi.fn().mockResolvedValue({ ok: true }) }));
const callEnvelopeMock = vi.fn<() => Promise<EnvelopeResult>>();
vi.mock('@/lib/google-apps-script/client', () => ({ callAppsScriptEnvelope: (...args: unknown[]) => callEnvelopeMock(...(args as [])) }));

const saveEvidenceMock = vi.fn();
const deleteEvidenceMock = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/evidence/storage', () => ({
  saveEvidence: (...args: unknown[]) => saveEvidenceMock(...args),
  deleteEvidence: (...args: unknown[]) => deleteEvidenceMock(...args),
  isValidEvidenceEmployeeId: (id: string) => /^S2A\d{3,6}$/.test(id),
}));
const appendManyMock = vi.fn().mockResolvedValue(undefined);
let evidenceSequence = 0;
vi.mock('@/lib/repositories/leave-evidence-repository', () => ({
  generateEvidenceId: () => `EVD-${++evidenceSequence}`,
  appendMany: (...args: unknown[]) => appendManyMock(...args),
}));

import { POST } from '@/app/api/leave/route';

const EMPLOYEE: Employee = { lineUserId: 'U-e', employeeId: 'S2A001', name: 'อาร์ม', position: 'dev', department: 'IT', managerLineUserId: 'U-mgr' };
const BALANCE = { sickTotal: 30, sickUsed: 0, personalTotal: 30, personalUsed: 0, annualTotal: 30, annualUsed: 0 };
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
type Upload = { bytes: Uint8Array; name: string; type: string };

let requestSequence = 0;
function form(files: Upload[] = [], field = 'evidenceFiles'): Request {
  const fd = new FormData();
  fd.append('clientRequestId', `cid-${++requestSequence}`);
  fd.append('leaveType', 'ลาป่วย');
  fd.append('startDate', '2026-08-10');
  fd.append('endDate', '2026-08-11');
  fd.append('reason', 'ปวดหัว');
  for (const file of files) fd.append(field, new File([file.bytes as unknown as BlobPart], file.name, { type: file.type }));
  return new Request('http://localhost:3333/api/leave', { method: 'POST', headers: { authorization: 'Bearer token' }, body: fd });
}

beforeAll(() => {
  process.env.LEAVE_EVIDENCE_DIR = '/tmp/evidence-test';
  process.env.LEAVE_EVIDENCE_MAX_BYTES = '10485760';
});
afterAll(() => {
  delete process.env.LEAVE_EVIDENCE_DIR;
  delete process.env.LEAVE_EVIDENCE_MAX_BYTES;
});
beforeEach(() => {
  vi.clearAllMocks();
  evidenceSequence = 0;
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: `U-e-${requestSequence}` } });
  findByLineUserIdMock.mockResolvedValue(EMPLOYEE);
  callEnvelopeMock.mockResolvedValue({ ok: true, envelope: { success: true, code: 'OK', data: BALANCE } });
  createMock.mockResolvedValue(undefined);
  setEvidenceMetadataMock.mockResolvedValue(undefined);
  appendManyMock.mockResolvedValue(undefined);
  saveEvidenceMock.mockImplementation(async ({ ext }: { ext: string }) => {
    const index = saveEvidenceMock.mock.calls.length;
    return { storedFileName: `file-${index}.${ext}`, relativePath: `S2A001/REQ/file-${index}.${ext}`, absolutePath: `/tmp/file-${index}.${ext}` };
  });
  deleteEvidenceMock.mockResolvedValue(true);
});

async function json(response: Response) { return await response.json() as { code: string; data?: Record<string, unknown> }; }

describe('POST /api/leave — multiple optional evidence files', () => {
  it('no evidence still works', async () => {
    const response = await POST(form());
    expect(response.status).toBe(201);
    expect((await json(response)).data?.evidenceStatus).toBe('NONE');
    expect(saveEvidenceMock).not.toHaveBeenCalled();
  });

  it('one JPG works, including the legacy field name', async () => {
    const response = await POST(form([{ bytes: JPG, name: 'note.jpg', type: 'image/jpeg' }], 'evidence'));
    expect(response.status).toBe(201);
    expect((await json(response)).data).toMatchObject({ evidenceStatus: 'AVAILABLE', evidenceCount: 1 });
  });

  it.each([
    ['JPG + PDF', [{ bytes: JPG, name: 'note.jpg', type: 'image/jpeg' }, { bytes: PDF, name: 'receipt.pdf', type: 'application/pdf' }]],
    ['JPG + PNG + PDF', [{ bytes: JPG, name: 'note.jpg', type: 'image/jpeg' }, { bytes: PNG, name: 'photo.png', type: 'image/png' }, { bytes: PDF, name: 'receipt.pdf', type: 'application/pdf' }]],
  ] as const)('stores %s under one request and commits metadata once', async (_name, files) => {
    const response = await POST(form([...files]));
    expect(response.status).toBe(201);
    expect(saveEvidenceMock).toHaveBeenCalledTimes(files.length);
    expect(appendManyMock).toHaveBeenCalledTimes(1);
    expect(appendManyMock.mock.calls[0][0]).toHaveLength(files.length);
  });

  it('accepts exactly 5 files', async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ bytes: JPG, name: `${i}.jpg`, type: 'image/jpeg' }));
    const response = await POST(form(files));
    expect(response.status).toBe(201);
    expect(saveEvidenceMock).toHaveBeenCalledTimes(5);
  });

  it('rejects a 6th file before writing the request or evidence', async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ bytes: JPG, name: `${i}.jpg`, type: 'image/jpeg' }));
    const response = await POST(form(files));
    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe('TOO_MANY_EVIDENCE_FILES');
    expect(createMock).not.toHaveBeenCalled();
    expect(saveEvidenceMock).not.toHaveBeenCalled();
  });

  it('rejects a file over 10 MB before creating the request', async () => {
    process.env.LEAVE_EVIDENCE_MAX_BYTES = '4';
    const response = await POST(form([{ bytes: JPG, name: 'large.jpg', type: 'image/jpeg' }]));
    process.env.LEAVE_EVIDENCE_MAX_BYTES = '10485760';
    expect(response.status).toBe(413);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects SVG and fake extension/magic bytes', async () => {
    const svg = new TextEncoder().encode('<svg></svg>');
    const unsupported = await POST(form([{ bytes: svg, name: 'x.svg', type: 'image/svg+xml' }]));
    expect(unsupported.status).toBe(415);
    const mismatch = await POST(form([{ bytes: PNG, name: 'fake.jpg', type: 'image/jpeg' }]));
    expect(mismatch.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('cleans files written in this attempt when a later storage write fails, but keeps leave policy', async () => {
    saveEvidenceMock
      .mockResolvedValueOnce({ storedFileName: 'one.jpg', relativePath: 'S2A001/REQ/one.jpg', absolutePath: '/tmp/one.jpg' })
      .mockRejectedValueOnce(new Error('disk full'));
    const response = await POST(form([
      { bytes: JPG, name: 'one.jpg', type: 'image/jpeg' },
      { bytes: PDF, name: 'two.pdf', type: 'application/pdf' },
    ]));
    expect(response.status).toBe(201);
    expect((await json(response)).data?.evidenceStatus).toBe('UPLOAD_FAILED');
    expect(deleteEvidenceMock).toHaveBeenCalledWith('/tmp/evidence-test', 'S2A001/REQ/one.jpg');
    expect(appendManyMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
